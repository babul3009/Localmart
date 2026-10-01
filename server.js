const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const { rateLimit } = require("express-rate-limit");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const multer = require("multer");

const app = express();
const db = new Database(path.join(__dirname, "marketplace.db"));
const production = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 3000;
const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

if (production && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production.");
}

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('product', 'service')),
    name TEXT NOT NULL,
    detail TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    country TEXT NOT NULL,
    state TEXT NOT NULL,
    city TEXT NOT NULL,
    area TEXT NOT NULL,
    price REAL NOT NULL CHECK(price >= 0),
    currency TEXT NOT NULL DEFAULT 'INR',
    contact_phone TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS listing_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_listing_images_listing
  ON listing_images(listing_id, id);

  CREATE INDEX IF NOT EXISTS idx_listing_category
  ON listings(category);

  CREATE INDEX IF NOT EXISTS idx_listing_city
  ON listings(city COLLATE NOCASE);

  CREATE INDEX IF NOT EXISTS idx_listing_category_city
  ON listings(category, city COLLATE NOCASE);
`);

// Keep older databases compatible with the new contact feature.
try {
  db.exec("ALTER TABLE listings ADD COLUMN contact_phone TEXT");
} catch (error) {
  if (!String(error.message).includes("duplicate column name")) throw error;
}

const categories = {
  Electronics: ["Mobiles", "Laptops", "TV & Audio", "Accessories"],
  Vehicles: ["Cars", "Motorcycles", "Bicycles", "Spare Parts"],
  Property: ["For Sale", "For Rent", "Commercial", "Land"],
  Furniture: ["Sofas", "Beds", "Tables", "Home Decor"],
  Fashion: ["Clothing", "Shoes", "Watches", "Accessories"],
  Services: ["Repairs", "Cleaning", "Tutoring", "Design", "Other"],
  Other: ["General"]
};

const currencies = ["INR", "USD", "EUR", "GBP", "AED"];

app.disable("x-powered-by");

app.use(express.json({ limit: "32kb" }));

app.use(
  session({
    name: "localmart.sid",
    secret:
      process.env.SESSION_SECRET ||
      crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: production,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

// Prevent other websites from submitting authenticated mutations.
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");

  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers["sec-fetch-site"] === "cross-site"
  ) {
    return res.status(403).json({ error: "Cross-site request blocked." });
  }

  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !req.is("application/json") &&
    !(req.path === "/listings" && req.is("multipart/form-data"))
  ) {
    return res.status(415).json({ error: "JSON requests are required." });
  }

  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many attempts. Please try again in 15 minutes."
  }
});

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Please log in first." });
  }

  next();
}

function startSession(req, res, next, user, status = 200) {
  req.session.regenerate((error) => {
    if (error) return next(error);

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email
    };

    req.session.save((saveError) => {
      if (saveError) return next(saveError);
      res.status(status).json({ user: req.session.user });
    });
  });
}

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  }
});

const imageUpload = multer({
  storage: imageStorage,
  limits: {
    files: 6,
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, and WebP images are allowed."));
    }
  }
});

function removeUploadedFiles(files = []) {
  for (const file of files) {
    try {
      fs.unlinkSync(file.path);
    } catch (_error) {}
  }
}

app.get("/api/meta", (req, res) => {
  const cities = db.prepare(`
    SELECT
      MIN(city) AS city,
      MIN(country) AS country,
      COUNT(*) AS count
    FROM listings
    GROUP BY city COLLATE NOCASE
    ORDER BY city COLLATE NOCASE
  `).all();

  const counts = db.prepare(`
    SELECT category, COUNT(*) AS count
    FROM listings
    GROUP BY category
  `).all();

  res.json({
    categories,
    currencies,
    cities,
    counts: Object.fromEntries(
      counts.map((item) => [item.category, item.count])
    )
  });
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/register", authLimiter, async (req, res, next) => {
  try {
    const name = clean(req.body.name);
    const email = clean(req.body.email).toLowerCase();
    const password = req.body.password;

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({
        error: "Name must contain between 2 and 80 characters."
      });
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({ error: "Enter a valid email." });
    }

    if (
      typeof password !== "string" ||
      password.length < 8 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        error: "Password must be at least 8 characters and at most 72 bytes."
      });
    }

    const existing = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(email);

    if (existing) {
      return res.status(409).json({
        error: "An account already exists with this email."
      });
    }

    const hash = await bcrypt.hash(password, 12);

    let result;

    try {
      result = db.prepare(`
        INSERT INTO users (name, email, password_hash)
        VALUES (?, ?, ?)
      `).run(name, email, hash);
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({
          error: "An account already exists with this email."
        });
      }
      throw error;
    }

    startSession(
      req,
      res,
      next,
      { id: Number(result.lastInsertRowid), name, email },
      201
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/login", authLimiter, async (req, res, next) => {
  try {
    const email = clean(req.body.email).toLowerCase();
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    if (Buffer.byteLength(password, "utf8") > 72) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    startSession(req, res, next, user);
  } catch (error) {
    next(error);
  }
});

app.post("/api/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);

    res.clearCookie("localmart.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: production
    });

    res.json({ success: true });
  });
});

app.get("/api/listings", (req, res) => {
  const conditions = [];
  const values = [];

  for (const key of ["category", "subcategory", "city", "type"]) {
    const value = clean(req.query[key]);

    if (value) {
      conditions.push(`l.${key} = ? COLLATE NOCASE`);
      values.push(value);
    }
  }

  const q = clean(req.query.q).slice(0, 100);

  if (q) {
    conditions.push("(l.name LIKE ? OR l.detail LIKE ?)");
    values.push(`%${q}%`, `%${q}%`);
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const page = Math.max(
    1,
    Math.min(100000, parseInt(req.query.page, 10) || 1)
  );

  const limit = 12;
  const offset = (page - 1) * limit;

  const sorts = {
    newest: "l.id DESC",
    price_low: "l.price ASC, l.id DESC",
    price_high: "l.price DESC, l.id DESC"
  };

  const sort = sorts[clean(req.query.sort)] || sorts.newest;

  const { total } = db.prepare(`
    SELECT COUNT(*) AS total
    FROM listings l
    ${where}
  `).get(...values);

  const listings = db.prepare(`
    SELECT l.*, u.name AS seller,
      (SELECT filename FROM listing_images li WHERE li.listing_id = l.id ORDER BY li.id LIMIT 1) AS image
    FROM listings l
    JOIN users u ON u.id = l.user_id
    ${where}
    ORDER BY ${sort}
    LIMIT ? OFFSET ?
  `).all(...values, limit, offset);

  res.json({
    listings: listings.map((listing) => ({
      ...listing,
      image: listing.image ? `/uploads/${listing.image}` : null
    })),
    total,
    page,
    pages: Math.ceil(total / limit)
  });
});

app.get("/api/listings/:id", (req, res) => {
  const listing = db.prepare(`
    SELECT l.*, u.name AS seller
    FROM listings l
    JOIN users u ON u.id = l.user_id
    WHERE l.id = ?
  `).get(req.params.id);

  if (!listing) {
    return res.status(404).json({ error: "Listing not found." });
  }

  const images = db.prepare(`
    SELECT id, filename, original_name
    FROM listing_images
    WHERE listing_id = ?
    ORDER BY id
  `).all(req.params.id).map((image) => ({
    ...image,
    url: `/uploads/${image.filename}`
  }));

  res.json({ listing: { ...listing, images } });
});

app.post("/api/listings", requireAuth, imageUpload.array("images", 6), (req, res) => {
  try {
    const fields = [
      "type",
      "name",
      "detail",
      "category",
      "subcategory",
      "country",
      "state",
      "city",
      "area"
    ];

    const item = Object.fromEntries(
      fields.map((field) => [field, clean(req.body[field])])
    );

    if (fields.some((field) => !item[field])) {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: "Please complete all listing fields." });
    }

    if (!["product", "service"].includes(item.type)) {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: "Invalid listing type." });
    }

    if (
      !Object.hasOwn(categories, item.category) ||
      !categories[item.category].includes(item.subcategory)
    ) {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: "Select a valid category and subcategory." });
    }

    if (
      item.name.length < 3 ||
      item.name.length > 120 ||
      item.detail.length < 10 ||
      item.detail.length > 5000
    ) {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: "Use a 3–120 character name and a 10–5000 character detail." });
    }

    if (["country", "state", "city", "area"].some((field) => item[field].length > 100)) {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: "Location fields must be at most 100 characters." });
    }

    const contactPhone = clean(req.body.contact_phone).replace(/[^0-9+]/g, "");
    const phoneDigits = contactPhone.replace(/\D/g, "");

    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: "Enter a valid contact / WhatsApp number." });
    }

    const rawPrice = req.body.price;
    if (!["string", "number"].includes(typeof rawPrice) || String(rawPrice).trim() === "") {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: "Enter a valid price." });
    }

    const price = Number(rawPrice);
    const currency = clean(req.body.currency) || "INR";

    if (!Number.isFinite(price) || price < 0 || price > 1e12) {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: "Enter a valid price." });
    }

    if (!currencies.includes(currency)) {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: "Select a supported currency." });
    }

    const createListing = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO listings (
          user_id, type, name, detail, category, subcategory,
          country, state, city, area, price, currency, contact_phone
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.session.user.id,
        ...fields.map((field) => item[field]),
        Math.round(price * 100) / 100,
        currency,
        phoneDigits
      );

      const listingId = Number(result.lastInsertRowid);
      const insertImage = db.prepare(`
        INSERT INTO listing_images (listing_id, filename, original_name)
        VALUES (?, ?, ?)
      `);

      for (const file of req.files || []) {
        insertImage.run(listingId, file.filename, file.originalname);
      }

      return listingId;
    });

    const id = createListing();
    res.status(201).json({ id });
  } catch (error) {
    removeUploadedFiles(req.files);
    throw error;
  }
});

app.delete("/api/listings/:id", requireAuth, (req, res) => {
  const listing = db.prepare("SELECT * FROM listings WHERE id = ?").get(req.params.id);

  if (!listing) {
    return res.status(404).json({ error: "Listing not found." });
  }

  if (listing.user_id !== req.session.user.id) {
    return res.status(403).json({ error: "You can only delete your own listings." });
  }

  const images = db.prepare(
    "SELECT filename FROM listing_images WHERE listing_id = ?"
  ).all(listing.id);

  db.prepare("DELETE FROM listings WHERE id = ?").run(listing.id);

  for (const image of images) {
    try {
      fs.unlinkSync(path.join(uploadsDir, image.filename));
    } catch (_error) {}
  }

  res.json({ success: true });
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API endpoint not found." });
});

app.use("/uploads", express.static(uploadsDir, { fallthrough: false }));
app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);

  const status = error.status === 400 ? 400 : 500;

  res.status(status).json({
    error: status === 400 ? "Invalid request." : "Something went wrong."
  });
});

app.listen(PORT, () => {
  console.log(`LocalMart running at http://localhost:${PORT}`);
});