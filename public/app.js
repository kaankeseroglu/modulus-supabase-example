let client;
let selectedProductionId = null;
let rosRealtimeChannel = null;

const $ = (id) => document.getElementById(id);

const config = {
  url: localStorage.getItem("modulus_demo_supabase_url") ?? "",
  anonKey: localStorage.getItem("modulus_demo_supabase_anon_key") ?? "",
};

$("supabase-url").value = config.url;
$("supabase-anon-key").value = config.anonKey;
$("event-date").valueAsDate = new Date();

wireEvents();
initClient();

function wireEvents() {
  $("save-config").addEventListener("click", () => {
    config.url = $("supabase-url").value.trim();
    config.anonKey = $("supabase-anon-key").value.trim();
    localStorage.setItem("modulus_demo_supabase_url", config.url);
    localStorage.setItem("modulus_demo_supabase_anon_key", config.anonKey);
    initClient();
  });

  onClick("sign-up", signUp);
  onClick("sign-in", signIn);
  onClick("sign-out", signOut);
  onClick("create-production", createProduction);
  onClick("reload-productions", loadProductions);
  onClick("add-ros-item", addRosItem);
  onClick("add-contact", addContact);
  onClick("upload-asset", uploadAsset);
  onClick("create-crew-token", createCrewToken);
  onClick("load-crew-view", loadCrewView);
  onClick("send-notification", sendNotification);
}

function onClick(id, handler) {
  $(id).addEventListener("click", async () => {
    try {
      await handler();
    } catch (error) {
      setError("config-status", error instanceof Error ? error.message : "Unexpected error");
    }
  });
}

async function initClient() {
  if (!config.url || !config.anonKey) {
    setStatus("config-status", "Enter a Supabase URL and anon key.");
    return;
  }

  client = window.supabase.createClient(config.url, config.anonKey);
  setStatus("config-status", "Supabase client configured.");

  const {
    data: { session },
  } = await client.auth.getSession();

  setStatus("auth-status", session?.user ? `Signed in as ${session.user.email}` : "Not signed in.");

  if (session?.user) {
    await loadProductions();
  }
}

async function signUp() {
  await requireClient();
  const { error } = await client.auth.signUp({
    email: $("email").value.trim(),
    password: $("password").value,
  });

  if (error) return setError("auth-status", error.message);
  setStatus("auth-status", "Sign-up submitted. Check email confirmation settings in Supabase Auth.");
}

async function signIn() {
  await requireClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });

  if (error) return setError("auth-status", error.message);
  setStatus("auth-status", `Signed in as ${data.user.email}`);
  await loadProductions();
}

async function signOut() {
  await requireClient();
  await client.auth.signOut();
  selectedProductionId = null;
  $("productions").innerHTML = "";
  $("ros-items").innerHTML = "";
  $("contacts").innerHTML = "";
  $("assets").innerHTML = "";
  setStatus("auth-status", "Signed out.");
}

async function createProduction() {
  await requireClient();
  const { error } = await client.from("productions").insert({
    title: $("production-title").value.trim(),
    event_date: $("event-date").value || null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    settings: { source: "single-page-demo" },
  });

  if (error) return setError("config-status", error.message);
  await loadProductions();
}

async function loadProductions() {
  await requireClient();
  const { data, error } = await client
    .from("productions")
    .select("id, title, event_date, timezone")
    .order("created_at", { ascending: false });

  if (error) return setError("config-status", error.message);

  $("productions").innerHTML = "";

  for (const production of data ?? []) {
    const row = document.createElement("div");
    row.className = `row ${production.id === selectedProductionId ? "active" : ""}`;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(production.title)}</strong>
        <p>${production.event_date ?? "No date"} · ${escapeHtml(production.timezone)}</p>
      </div>
      <button class="secondary" data-production-id="${production.id}">Select</button>
    `;
    row.querySelector("button").addEventListener("click", () => selectProduction(production.id));
    $("productions").appendChild(row);
  }

  if (!selectedProductionId && data?.[0]?.id) {
    await selectProduction(data[0].id);
  }
}

async function selectProduction(id) {
  selectedProductionId = id;
  await subscribeToRosChanges();
  await Promise.all([loadRosItems(), loadContacts(), loadAssets(), loadProductions()]);
}

async function subscribeToRosChanges() {
  if (rosRealtimeChannel) {
    await client.removeChannel(rosRealtimeChannel);
  }

  rosRealtimeChannel = client
    .channel(`ros-items:${selectedProductionId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "ros_items",
        filter: `production_id=eq.${selectedProductionId}`,
      },
      () => loadRosItems(),
    )
    .subscribe();
}

async function addRosItem() {
  await requireProduction();
  const currentCount = $("ros-items").childElementCount;
  const { error } = await client.from("ros_items").insert({
    production_id: selectedProductionId,
    sort_order: currentCount + 1,
    timecode: $("ros-timecode").value.trim(),
    cue: $("ros-cue").value.trim(),
    department: $("ros-department").value.trim(),
    owner: $("ros-owner").value.trim(),
    segment: $("ros-segment").value.trim(),
    is_private: $("ros-private").checked,
  });

  if (error) return setError("config-status", error.message);
  await loadRosItems();
}

async function loadRosItems() {
  if (!selectedProductionId) return;
  const { data, error } = await client
    .from("ros_items")
    .select("id, sort_order, timecode, segment, cue, department, owner, is_private")
    .eq("production_id", selectedProductionId)
    .order("sort_order", { ascending: true });

  if (error) return setError("config-status", error.message);

  $("ros-items").innerHTML = "";
  for (const item of data ?? []) {
    appendRow("ros-items", `
      <div>
        <strong>${escapeHtml(item.sort_order)}. ${escapeHtml(item.cue)}</strong>
        <p>${escapeHtml(item.timecode ?? "")} · ${escapeHtml(item.segment ?? "")} · ${escapeHtml(item.department ?? "")} · ${escapeHtml(item.owner ?? "")}${item.is_private ? " · private" : ""}</p>
      </div>
    `);
  }
}

async function addContact() {
  await requireProduction();
  const departments = $("contact-departments").value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const { error } = await client.from("contacts").insert({
    production_id: selectedProductionId,
    name: $("contact-name").value.trim(),
    role: $("contact-role").value.trim(),
    department_tags: departments,
    tab_assignments: departments,
    email: $("contact-email").value.trim() || null,
    phone: $("contact-phone").value.trim() || null,
    is_private: $("contact-private").checked,
  });

  if (error) return setError("config-status", error.message);
  await loadContacts();
}

async function loadContacts() {
  if (!selectedProductionId) return;
  const { data, error } = await client
    .from("contacts")
    .select("id, name, role, department_tags, email, phone, is_private")
    .eq("production_id", selectedProductionId)
    .order("name", { ascending: true });

  if (error) return setError("config-status", error.message);

  $("contacts").innerHTML = "";
  for (const contact of data ?? []) {
    appendRow("contacts", `
      <div>
        <strong>${escapeHtml(contact.name)}</strong>
        <p>${escapeHtml(contact.role ?? "")} · ${escapeHtml((contact.department_tags ?? []).join(", "))} · ${escapeHtml(contact.email ?? "no email")} · ${escapeHtml(contact.phone ?? "no phone")}${contact.is_private ? " · private" : ""}</p>
      </div>
    `);
  }
}

async function uploadAsset() {
  await requireProduction();
  const file = $("asset-file").files[0];
  if (!file) return setError("config-status", "Choose a file first.");

  const storagePath = `${selectedProductionId}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
  const { error: uploadError } = await client.storage.from("show-assets").upload(storagePath, file);

  if (uploadError) return setError("config-status", uploadError.message);

  const { error: metadataError } = await client.from("show_assets").insert({
    production_id: selectedProductionId,
    storage_path: storagePath,
    original_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
    visibility: $("asset-crew-visible").checked ? "crew_read" : "members_only",
  });

  if (metadataError) return setError("config-status", metadataError.message);
  await loadAssets();
}

async function loadAssets() {
  if (!selectedProductionId) return;
  const { data, error } = await client
    .from("show_assets")
    .select("id, storage_path, original_name, mime_type, size_bytes, visibility")
    .eq("production_id", selectedProductionId)
    .order("created_at", { ascending: false });

  if (error) return setError("config-status", error.message);

  $("assets").innerHTML = "";

  for (const asset of data ?? []) {
    const { data: signedUrl } = await client.storage
      .from("show-assets")
      .createSignedUrl(asset.storage_path, 60 * 10);

    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(asset.original_name)}</strong>
        <p>${escapeHtml(asset.mime_type ?? "unknown type")} · ${formatBytes(asset.size_bytes)} · ${escapeHtml(asset.visibility)}</p>
      </div>
      ${signedUrl?.signedUrl ? `<a class="button-link secondary" href="${signedUrl.signedUrl}" target="_blank" rel="noreferrer">Open signed URL</a>` : ""}
    `;
    $("assets").appendChild(row);
  }
}

async function createCrewToken() {
  await requireProduction();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  const { data, error } = await client
    .from("crew_share_tokens")
    .insert({
      production_id: selectedProductionId,
      label: "Demo crew link",
      expires_at: expiresAt,
    })
    .select("token")
    .single();

  if (error) return setError("config-status", error.message);
  $("crew-token").value = data.token;
}

async function loadCrewView() {
  await requireClient();
  const token = $("crew-token").value.trim();
  const { data, error } = await client.rpc("get_crew_show_snapshot", { share_token: token });

  if (error) return setError("config-status", error.message);
  $("crew-view").textContent = JSON.stringify(data, null, 2);
}

async function sendNotification() {
  await requireProduction();
  const channels = [];
  if ($("notify-email").checked) channels.push("email");
  if ($("notify-sms").checked) channels.push("sms");

  const { data, error } = await client.functions.invoke("send-notification", {
    body: {
      production_id: selectedProductionId,
      subject: $("notification-subject").value.trim(),
      body: $("notification-body").value.trim(),
      channels,
    },
  });

  if (error) return setError("config-status", error.message);
  $("notification-result").textContent = JSON.stringify(data, null, 2);
}

async function requireClient() {
  if (!client) throw new Error("Configure Supabase first.");
}

async function requireProduction() {
  await requireClient();
  if (!selectedProductionId) throw new Error("Select or create a production first.");
}

function appendRow(target, html) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = html;
  $(target).appendChild(row);
}

function setStatus(id, message) {
  const el = $(id);
  el.classList.remove("error");
  el.textContent = message;
}

function setError(id, message) {
  const el = $(id);
  el.classList.add("error");
  el.textContent = message;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeFileName(value) {
  return value.replace(/[^a-z0-9._-]/gi, "-").toLowerCase();
}

function formatBytes(value) {
  if (!Number.isFinite(Number(value))) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(value);
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
