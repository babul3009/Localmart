const root = document.getElementById("app");
const account = document.getElementById("account");

let user = null;
let meta = { categories: {}, cities: [], counts: {}, currencies: [] };
let renderVersion = 0;
let toastTimer;

const icons = {
  Electronics: "💻",
  Vehicles: "🚲",
  Property: "🏡",
  Furniture: "🛋️",
  Fashion: "👟",
  Services: "🛠️",
  Other: "📦"
};

const colors = {
  Electronics: "#e4edf3",
  Vehicles: "#e8efdf",
  Property: "#e9e5f1",
  Furniture: "#f2e8dc",
  Fashion: "#f5e5e5",
  Services: "#e1efeb",
  Other: "#eceee5"
};

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

const e = escapeHTML;
const enc = encodeURIComponent;

function whatsappNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

async function api(url, method = "GET", body) {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? {} : {
      "Content-Type": "application/json"
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {})
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function notify(message) {
  const toast = document.getElementById("toast");

  toast.textContent = message;
  toast.classList.add("visible");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3500);
}

function navigate(url) {
  history.pushState({}, "", url);
  render();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function updateAccount() {
  account.innerHTML = user
    ? `
      <span class="user-name">Hi, ${e(user.name)}</span>
      <button class="text-button" id="logout">Log out</button>
      <a class="button" href="/add" data-link>＋ Post an ad</a>
    `
    : `
      <a class="text-link" href="/login" data-link>Log in</a>
      <a class="button" href="/add" data-link>＋ Post an ad</a>
    `;
}

function money(item) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: item.currency,
    maximumFractionDigits: 2
  }).format(item.price);
}

function dateLabel(value) {
  return new Date(value.replace(" ", "T") + "Z").toLocaleDateString(
    undefined,
    { day: "numeric", month: "short" }
  );
}

function options(values, selected = "", placeholder = "Select") {
  return `
    <option value="">${e(placeholder)}</option>
    ${values.map((value) => `
      <option value="${e(value)}" ${value === selected ? "selected" : ""}>
        ${e(value)}
      </option>
    `).join("")}
  `;
}

function browseURL(category = "", city = "", extras = {}) {
  let pathname = "/";

  if (city && category) {
    pathname = `/city/${enc(city)}/category/${enc(category)}`;
  } else if (city) {
    pathname = `/city/${enc(city)}`;
  } else if (category) {
    pathname = `/category/${enc(category)}`;
  }

  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(extras)) {
    if (value !== "" && value !== null && value !== undefined) {
      query.set(key, value);
    }
  }

  return pathname + (query.size ? `?${query}` : "");
}

function categoryCards(city = "") {
  return `
    <div class="category-grid">
      ${Object.keys(meta.categories).map((category) => `
        <a
          class="category-card"
          href="${e(browseURL(category, city))}"
          data-link
        >
          <span
            class="category-icon"
            style="background:${colors[category]}"
            aria-hidden="true"
          >${icons[category]}</span>

          <strong>${e(category)}</strong>

          <small>
            ${city ? "Explore nearby" : `${meta.counts[category] || 0} listings`}
          </small>
        </a>
      `).join("")}
    </div>
  `;
}

function listingCard(item) {
  return `
    <a class="listing-card" href="/listing/${item.id}" data-link>
      <div
        class="listing-art ${item.image ? "has-image" : ""}"
        style="--art:${colors[item.category] || colors.Other}"
      >
        ${item.image
          ? `<img src="${e(item.image)}" alt="${e(item.name)}" loading="lazy" />`
          : `<span aria-hidden="true">${icons[item.category] || icons.Other}</span>`}
        <span class="badge">${e(item.type)}</span>
      </div>

      <div class="card-body">
        <div class="price">${e(money(item))}</div>
        <h3>${e(item.name)}</h3>

        <div class="card-meta">
          <span>⌖ ${e(item.area)}, ${e(item.city)}</span>
          <span>${e(dateLabel(item.created_at))}</span>
        </div>
      </div>
    </a>
  `;
}

function emptyListings() {
  return `
    <div class="empty">
      <div style="font-size:40px" aria-hidden="true">🌱</div>
      <h2>Something great could start here</h2>
      <p>No listings match these filters. Try another search or post an ad.</p>
      <a class="button" href="/add" data-link>Post the first listing</a>
    </div>
  `;
}

function pageHeading(title, description) {
  return `
    <div class="page-title">
      <div class="eyebrow">Your neighborhood marketplace</div>
      <h1>${e(title)}</h1>
      <p>${e(description)}</p>
    </div>
  `;
}

async function renderBrowse(category, city, version) {
  const query = new URLSearchParams(location.search);
  const q = query.get("q") || "";
  const type = query.get("type") || "";
  const sort = query.get("sort") || "newest";

  const params = new URLSearchParams(query);

  params.set("category", category);
  params.set("city", city);

  const result = await api(`/api/listings?${params}`);

  if (version !== renderVersion) return;

  const home = !category && !city;

  const title = category && city
    ? `${category} in ${city}`
    : category
      ? `${category} listings`
      : city
        ? `Explore ${city}`
        : "Fresh finds near you";

  document.title = `${home ? "Your neighborhood marketplace" : title} | LocalMart`;

  root.innerHTML = `
    ${home ? `
      <section class="hero">
        <div class="eyebrow">Good things are closer than you think</div>
        <h1>Your next great find.<br><span>Right in your neighborhood.</span></h1>
        <p>Buy, sell, and discover products and services from people around you.</p>

        <form id="hero-search" class="searchbar">
          <input
            name="q"
            placeholder="What are you looking for?"
            aria-label="Search products and services"
            maxlength="100"
            value="${e(q)}"
          />

          <select name="city" aria-label="Choose city">
            ${options(meta.cities.map((item) => item.city), "", "All cities")}
          </select>

          <button class="button" type="submit">Search →</button>
        </form>
      </section>

      <div class="section-heading">
        <h2>Explore categories</h2>
        <a class="text-link" href="/categories" data-link>View all →</a>
      </div>

      ${categoryCards()}
    ` : `
      ${pageHeading(title, "Discover local products and services, all in one place.")}
      ${city && !category ? categoryCards(city) : ""}
    `}

    <div class="section-heading">
      <div>
        <h2>${e(title)}</h2>
        <p>${result.total} listing${result.total === 1 ? "" : "s"} available</p>
      </div>

      ${(category || city || location.search) ? `
        <a class="text-link" href="/" data-link>Clear filters</a>
      ` : `<span class="badge">Just listed</span>`}
    </div>

    <form id="filters" class="filters">
      <input
        name="q"
        placeholder="Search listings..."
        aria-label="Search listings"
        value="${e(q)}"
        maxlength="100"
      />

      <select name="category" aria-label="Filter by category">
        ${options(Object.keys(meta.categories), category, "All categories")}
      </select>

      <select name="city" aria-label="Filter by city">
        ${options(
          [...new Set([...meta.cities.map((item) => item.city), ...(city ? [city] : [])])],
          city,
          "All cities"
        )}
      </select>

      <select name="type" aria-label="Filter by listing type">
        <option value="">All types</option>
        <option value="product" ${type === "product" ? "selected" : ""}>Products</option>
        <option value="service" ${type === "service" ? "selected" : ""}>Services</option>
      </select>

      <select name="sort" aria-label="Sort listings">
        <option value="newest" ${sort === "newest" ? "selected" : ""}>Newest first</option>
        <option value="price_low" ${sort === "price_low" ? "selected" : ""}>Price: low to high</option>
        <option value="price_high" ${sort === "price_high" ? "selected" : ""}>Price: high to low</option>
      </select>

      <button class="button" type="submit">Apply</button>
    </form>

    ${result.listings.length
      ? `<div class="listing-grid">${result.listings.map(listingCard).join("")}</div>`
      : emptyListings()
    }

    ${result.pages > 1 ? `
      <div class="pagination">
        ${result.page > 1 ? `
          <a
            class="button secondary small"
            href="${e(browseURL(category, city, {
              ...Object.fromEntries(query),
              page: result.page - 1
            }))}"
            data-link
          >← Previous</a>
        ` : ""}

        <span class="muted">Page ${result.page} of ${result.pages}</span>

        ${result.page < result.pages ? `
          <a
            class="button secondary small"
            href="${e(browseURL(category, city, {
              ...Object.fromEntries(query),
              page: result.page + 1
            }))}"
            data-link
          >Next →</a>
        ` : ""}
      </div>
    ` : ""}
  `;

  document.getElementById("hero-search")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    navigate(browseURL("", data.city, { q: data.q.trim() }));
  });

  document.getElementById("filters").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));

    navigate(browseURL(data.category, data.city, {
      q: data.q.trim(),
      type: data.type,
      sort: data.sort
    }));
  });
}

function renderCategories() {
  document.title = "Categories | LocalMart";

  root.innerHTML = `
    ${pageHeading("Find your kind of great", "Browse products and services by category.")}
    ${categoryCards()}
  `;
}

function renderCities() {
  document.title = "Explore cities | LocalMart";

  root.innerHTML = `
    ${pageHeading("A marketplace in your city", "Choose a city to discover what's available nearby.")}

    ${meta.cities.length ? `
      <div class="city-grid">
        ${meta.cities.map((item) => `
          <a class="city-card" href="/city/${enc(item.city)}" data-link>
            <div>
              <strong>⌖ ${e(item.city)}</strong>
              <small>${item.count} listing${item.count === 1 ? "" : "s"}</small>
            </div>
            <span>→</span>
          </a>
        `).join("")}
      </div>
    ` : `
      <div class="empty">
        <h2>Put your city on the map</h2>
        <p>Cities appear here automatically when someone posts a listing.</p>
        <a class="button" href="/add" data-link>Create a listing</a>
      </div>
    `}
  `;
}

async function renderDetail(id, version) {
  const { listing: item } = await api(`/api/listings/${enc(id)}`);

  if (version !== renderVersion) return;

  document.title = `${item.name} | LocalMart`;

  const facts = {
    Type: item.type,
    Category: item.category,
    Subcategory: item.subcategory,
    Country: item.country,
    State: item.state,
    City: item.city,
    Area: item.area,
    Posted: dateLabel(item.created_at)
  };

  root.innerHTML = `
    <div class="breadcrumb">
      <a href="/" data-link>Home</a>
      <span>/</span>
      <a href="/category/${enc(item.category)}" data-link>${e(item.category)}</a>
      <span>/</span>
      <a
        href="${e(browseURL(item.category, item.city))}"
        data-link
      >${e(item.city)}</a>
    </div>

    <div class="detail-layout">
      <div>
        ${item.images?.length ? `
          <div class="gallery" data-gallery>
            <div class="gallery-main">
              <img
                id="gallery-main-image"
                src="${e(item.images[0].url)}"
                alt="${e(item.name)} - image 1"
              />
              ${item.images.length > 1 ? `
                <button class="gallery-nav gallery-prev" type="button" aria-label="Previous image">‹</button>
                <button class="gallery-nav gallery-next" type="button" aria-label="Next image">›</button>
                <span class="gallery-count" id="gallery-count">1 / ${item.images.length}</span>
              ` : ""}
            </div>
            ${item.images.length > 1 ? `
              <div class="gallery-thumbs" role="list">
                ${item.images.map((image, index) => `
                  <button
                    type="button"
                    class="gallery-thumb ${index === 0 ? "active" : ""}"
                    data-index="${index}"
                    aria-label="View image ${index + 1}"
                  >
                    <img src="${e(image.url)}" alt="" loading="lazy" />
                  </button>
                `).join("")}
              </div>
            ` : ""}
          </div>
        ` : `
          <div
            class="listing-art detail-art"
            style="--art:${colors[item.category] || colors.Other}"
            aria-label="${e(item.category)} illustration"
          >
            <span aria-hidden="true">${icons[item.category] || icons.Other}</span>
          </div>
        `}

        <section class="panel">
          <h2>Description</h2>
          <p class="description">${e(item.detail)}</p>

          <h2>Listing details</h2>

          <dl class="facts">
            ${Object.entries(facts).map(([label, value]) => `
              <div>
                <dt>${e(label)}</dt>
                <dd>${e(value)}</dd>
              </div>
            `).join("")}
          </dl>
        </section>
      </div>

      <aside>
        <section class="panel">
          <span class="badge">${e(item.type)}</span>
          <div class="price detail-price">${e(money(item))}</div>
          <h1 class="detail-name">${e(item.name)}</h1>
          <p class="muted">⌖ ${e(item.area)}, ${e(item.city)}, ${e(item.state)}</p>
          <p class="muted">Listing #${item.id} · ${e(dateLabel(item.created_at))}</p>
        </section>

        <section class="panel">
          <h2>Listed by</h2>
          <div class="seller">
            <div class="avatar">${e(item.seller.slice(0, 1).toUpperCase())}</div>
            <div>
              <strong>${e(item.seller)}</strong>
              <div class="muted">LocalMart member</div>
            </div>
          </div>
        </section>

        <section class="panel contact-panel">
          <h2>Contact seller</h2>
          ${item.contact_phone ? `
            <div class="contact-actions">
              <a class="button" href="tel:${e(item.contact_phone)}">📞 Contact Seller</a>
              <a
                class="button whatsapp-button"
                href="https://wa.me/${whatsappNumber(item.contact_phone)}?text=${enc(`Hi, I'm interested in your LocalMart listing: ${item.name}`)}"
                target="_blank"
                rel="noopener noreferrer"
              >💬 WhatsApp</a>
            </div>
            <p class="form-note">${e(item.contact_phone)}</p>
          ` : `
            <p class="muted">The seller has not added a contact number.</p>
          `}
        </section>

        ${user && Number(user.id) === Number(item.user_id) ? `
          <section class="panel owner-panel">
            <h2>Your listing</h2>
            <button class="button danger" id="delete-listing" type="button">🗑️ Delete listing</button>
            <p class="form-note">Deleting this listing also removes its uploaded photos.</p>
          </section>
        ` : ""}

        <section class="panel safety">
          <strong>A little caution goes a long way</strong>
          <p>Inspect products before paying. Meet in a public place and never share passwords or verification codes.</p>
        </section>

        <a
          class="button secondary"
          href="${e(browseURL(item.category, item.city))}"
          data-link
        >More ${e(item.category)} in ${e(item.city)} →</a>
      </aside>
    </div>
  `;

  const deleteButton = document.getElementById("delete-listing");
  deleteButton?.addEventListener("click", async () => {
    if (!confirm("Delete this listing? This cannot be undone.")) return;

    deleteButton.disabled = true;

    try {
      await api(`/api/listings/${enc(id)}`, "DELETE");
      notify("Listing deleted.");
      navigate("/");
    } catch (error) {
      deleteButton.disabled = false;
      notify(error.message);
    }
  });

  const gallery = document.querySelector("[data-gallery]");
  if (gallery && item.images?.length) {
    const mainImage = document.getElementById("gallery-main-image");
    const count = document.getElementById("gallery-count");
    const thumbs = [...gallery.querySelectorAll(".gallery-thumb")];
    let current = 0;

    const showImage = (index) => {
      current = (index + item.images.length) % item.images.length;
      mainImage.src = item.images[current].url;
      mainImage.alt = `${item.name} - image ${current + 1}`;
      if (count) count.textContent = `${current + 1} / ${item.images.length}`;
      thumbs.forEach((thumb, thumbIndex) => thumb.classList.toggle("active", thumbIndex === current));
    };

    thumbs.forEach((thumb) => {
      thumb.addEventListener("click", () => showImage(Number(thumb.dataset.index)));
    });

    gallery.querySelector(".gallery-prev")?.addEventListener("click", () => showImage(current - 1));
    gallery.querySelector(".gallery-next")?.addEventListener("click", () => showImage(current + 1));

    mainImage.addEventListener("click", () => {
      const overlay = document.createElement("div");
      overlay.className = "image-lightbox";
      overlay.innerHTML = `
        <button type="button" class="lightbox-close" aria-label="Close image viewer">×</button>
        <img src="${e(item.images[current].url)}" alt="${e(item.name)}" />
      `;
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.closest(".lightbox-close")) close();
      });
      document.addEventListener("keydown", function onKey(event) {
        if (event.key === "Escape") {
          close();
          document.removeEventListener("keydown", onKey);
        }
      });
    });
  }
}

function field(label, name, type = "text", extra = "", value = "") {
  return `
    <label class="field">
      ${e(label)}
      <input
        name="${e(name)}"
        type="${e(type)}"
        value="${e(value)}"
        required
        ${extra}
      />
    </label>
  `;
}

function renderAuth(register) {
  document.title = `${register ? "Register" : "Log in"} | LocalMart`;

  root.innerHTML = `
    <section class="form-panel auth">
      ${pageHeading(
        register ? "Join your local community" : "Welcome back",
        register ? "Create an account to start posting listings." : "Log in to post products and services."
      )}

      <form id="auth-form" class="form-grid">
        ${register ? `
          <div class="full">
            ${field("Full name", "name", "text", 'minlength="2" maxlength="80" autocomplete="name"')}
          </div>
        ` : ""}

        <div class="full">
          ${field("Email address", "email", "email", 'maxlength="254" autocomplete="email"')}
        </div>

        <div class="full">
          ${field(
            "Password",
            "password",
            "password",
            `minlength="8" maxlength="72" autocomplete="${register ? "new-password" : "current-password"}"`
          )}
        </div>

        <p class="form-error full" role="alert"></p>

        <button class="button full" type="submit">
          ${register ? "Create account" : "Log in"}
        </button>
      </form>

      <p class="muted" style="margin-top:20px">
        ${register ? "Already have an account?" : "New to LocalMart?"}
        <a
          class="text-link"
          href="${register ? "/login" : "/register"}${e(location.search)}"
          data-link
        >${register ? "Log in" : "Create an account"}</a>
      </p>
    </section>
  `;

  document.getElementById("auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const button = form.querySelector("button");
    const error = form.querySelector(".form-error");

    button.disabled = true;
    error.textContent = "";

    try {
      const result = await api(
        register ? "/api/register" : "/api/login",
        "POST",
        Object.fromEntries(new FormData(form))
      );

      user = result.user;
      updateAccount();

      const next = new URLSearchParams(location.search).get("next");

      navigate(next === "/add" ? "/add" : "/");
      notify(register ? "Your account is ready!" : "Welcome back!");
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}

function renderAdd() {
  if (!user) {
    navigate("/login?next=/add");
    return;
  }

  document.title = "Post an ad | LocalMart";

  root.innerHTML = `
    <section class="form-panel">
      ${pageHeading("Give it a new home", "Post a product or service. Your listing will appear immediately.")}

      <form id="listing-form" class="form-grid">
        <label class="field">
          Product / Service
          <select name="type" required>
            <option value="product">Product</option>
            <option value="service">Service</option>
          </select>
        </label>

        ${field(
          "Listing name",
          "name",
          "text",
          'minlength="3" maxlength="120" placeholder="e.g. Wooden study table"'
        )}

        <label class="field full">
          Detail
          <textarea
            name="detail"
            required
            minlength="10"
            maxlength="5000"
            placeholder="Describe the item or service, condition, features, and anything a buyer should know."
          ></textarea>
        </label>

        <label class="field">
          Category
          <select name="category" id="listing-category" required>
            ${options(Object.keys(meta.categories), "", "Choose category")}
          </select>
        </label>

        <label class="field">
          Subcategory
          <select name="subcategory" id="listing-subcategory" required disabled>
            <option value="">Choose a category first</option>
          </select>
        </label>

        ${field("Country", "country", "text", 'maxlength="100" autocomplete="country-name"', "India")}
        ${field("State", "state", "text", 'maxlength="100" autocomplete="address-level1"')}
        ${field("City", "city", "text", 'maxlength="100" autocomplete="address-level2" list="known-cities"')}
        ${field("Area / Neighborhood", "area", "text", 'maxlength="100" autocomplete="address-level3"')}

        <datalist id="known-cities">
          ${meta.cities.map((item) => `<option value="${e(item.city)}"></option>`).join("")}
        </datalist>

        ${field("Contact / WhatsApp number", "contact_phone", "tel", 'maxlength="20" placeholder="e.g. 9876543210" autocomplete="tel"')}

        ${field("Price", "price", "number", 'min="0" max="1000000000000" step="0.01" placeholder="0.00"')}

        <label class="field full image-upload-field">
          Photos
          <input
            id="listing-images"
            name="images"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
          />
          <small class="form-note">Add up to 6 photos. JPG, PNG or WebP, max 5 MB each.</small>
          <div id="image-preview" class="image-preview" aria-live="polite"></div>
        </label>

        <label class="field">
          Currency
          <select name="currency" required>
            ${meta.currencies.map((currency) => `
              <option value="${currency}">${currency}</option>
            `).join("")}
          </select>
        </label>

        <p class="form-note full">
          Use clear descriptions and accurate locations. Do not include sensitive personal information.
        </p>

        <p class="form-error full" role="alert"></p>

        <button class="button full" type="submit">Publish listing →</button>
      </form>
    </section>
  `;

  document.getElementById("listing-category").addEventListener("change", (event) => {
    const subcategory = document.getElementById("listing-subcategory");
    const values = meta.categories[event.target.value] || [];

    subcategory.innerHTML = options(values, "", "Choose subcategory");
    subcategory.disabled = values.length === 0;
  });

  const imageInput = document.getElementById("listing-images");
  const imagePreview = document.getElementById("image-preview");

  imageInput.addEventListener("change", () => {
    const files = [...imageInput.files];
    imagePreview.innerHTML = "";

    if (files.length > 6) {
      imageInput.value = "";
      imagePreview.innerHTML = `<p class="form-error">Please choose no more than 6 photos.</p>`;
      return;
    }

    for (const file of files) {
      if (!file.type.match(/^image\/(jpeg|png|webp)$/) || file.size > 5 * 1024 * 1024) {
        imageInput.value = "";
        imagePreview.innerHTML = `<p class="form-error">Each photo must be JPG, PNG or WebP and 5 MB or smaller.</p>`;
        return;
      }

      const url = URL.createObjectURL(file);
      const wrapper = document.createElement("div");
      wrapper.className = "image-preview-item";
      wrapper.innerHTML = `<img src="${url}" alt="Selected photo preview" />`;
      imagePreview.appendChild(wrapper);
    }
  });

  document.getElementById("listing-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const error = form.querySelector(".form-error");

    button.disabled = true;
    error.textContent = "";

    try {
      const formData = new FormData(form);
      const response = await fetch("/api/listings", {
        method: "POST",
        credentials: "same-origin",
        body: formData
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Request failed.");
      }

      navigate(`/listing/${result.id}`);
      notify("Your listing is live!");
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}

async function render() {
  const version = ++renderVersion;

  root.innerHTML = `<div class="empty" role="status">Loading…</div>`;

  try {
    const freshMeta = await api("/api/meta");

    if (version !== renderVersion) return;

    meta = freshMeta;

    const parts = location.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);

    if (!parts.length) {
      await renderBrowse("", "", version);
    } else if (parts[0] === "categories" && parts.length === 1) {
      renderCategories();
    } else if (parts[0] === "cities" && parts.length === 1) {
      renderCities();
    } else if (parts[0] === "category" && parts.length === 2) {
      await renderBrowse(parts[1], "", version);
    } else if (
      parts[0] === "city" &&
      (parts.length === 2 || (parts.length === 4 && parts[2] === "category"))
    ) {
      await renderBrowse(parts[3] || "", parts[1], version);
    } else if (parts[0] === "listing" && parts.length === 2) {
      await renderDetail(parts[1], version);
    } else if (parts[0] === "register" && parts.length === 1) {
      renderAuth(true);
    } else if (parts[0] === "login" && parts.length === 1) {
      renderAuth(false);
    } else if (parts[0] === "add" && parts.length === 1) {
      renderAdd();
    } else {
      throw new Error("Page not found.");
    }
  } catch (error) {
    if (version !== renderVersion) return;

    root.innerHTML = `
      <div class="empty">
        <h2>We couldn't load this page</h2>
        <p>${e(error.message)}</p>
        <a class="button" href="/" data-link>Back to marketplace</a>
      </div>
    `;
  }
}

document.addEventListener("click", async (event) => {
  const link = event.target.closest("a[data-link]");

  if (
    link &&
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  ) {
    event.preventDefault();
    navigate(link.getAttribute("href"));
    return;
  }

  if (event.target.closest("#logout")) {
    try {
      await api("/api/logout", "POST");
      user = null;
      updateAccount();
      navigate("/");
      notify("You have been logged out.");
    } catch (error) {
      notify(error.message);
    }
  }
});

window.addEventListener("popstate", render);

async function boot() {
  try {
    const result = await api("/api/me");
    user = result.user;
    updateAccount();
    await render();
  } catch (error) {
    root.innerHTML = `
      <div class="empty">
        <h2>Unable to connect</h2>
        <p>${e(error.message)} Make sure the server is running, then refresh.</p>
      </div>
    `;
  }
}

boot();