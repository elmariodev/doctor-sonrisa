// Login and logout. The server sets an HttpOnly session cookie: this page
// never sees the token, and the role comes from the server, not from here.
const loginForm = document.getElementById("login");
const account = document.getElementById("account");

async function showAccount() {
  const me = await (await fetch("/api/me")).json();
  const inSession = me.role !== "guest";
  loginForm.hidden = inSession;
  account.hidden = !inSession;
  if (inSession) {
    document.getElementById("account-name").textContent = `${me.name} (${me.roleName})`;
    // An element that only exists while logged in, so scripts can wait for it
    account.querySelector("#logout")?.removeAttribute("disabled");
  }
  document.getElementById("who").textContent = inSession ? `${me.name} · ${me.roleName}` : "Invitado";
  document.getElementById("logout").style.display = inSession ? "" : "none";
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: document.getElementById("email").value, password: document.getElementById("password").value }),
  });
  const data = await res.json().catch(() => ({}));
  document.getElementById("login-error").textContent = res.ok ? "" : data.message || "No se pudo entrar.";
  if (res.ok) { document.getElementById("password").value = ""; await showAccount(); }
});

document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.reload();
});

showAccount();
