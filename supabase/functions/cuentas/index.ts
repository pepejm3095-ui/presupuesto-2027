// Activación de cuentas con código y alta de códigos por un administrador.
// Se despliega con verify_jwt = false: "activar" la usa alguien sin sesión;
// "codigo" valida aquí mismo que quien llama sea administrador.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function nuevoCodigo() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(10));
  const s = [...r].map((x) => abc[x % abc.length]).join("");
  return s.slice(0, 5) + "-" + s.slice(5);
}
async function buscarUsuario(email: string) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const u = data.users.find((x) => (x.email || "").toLowerCase() === email);
    if (u) return u;
    if (data.users.length < 1000) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return res("ok");
  if (req.method !== "POST") return res({ error: "Método no permitido" }, 405);
  let body: Record<string, string>;
  try { body = await req.json(); } catch { return res({ error: "Solicitud inválida" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();

  try {
    if (body.accion === "codigo") {
      // solo administradores
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u, error } = await svc.auth.getUser(token);
      if (error || !u?.user?.email) return res({ error: "Sesión no válida" }, 401);
      const { data: adm } = await svc.from("accesos").select("id")
        .eq("email", u.user.email.toLowerCase()).eq("rol", "admin").limit(1);
      if (!adm?.length) return res({ error: "Solo un administrador puede generar códigos" }, 403);
      const { data: tiene } = await svc.from("accesos").select("id").eq("email", email).limit(1);
      if (!tiene?.length) return res({ error: "Primero da de alta un acceso para ese correo" }, 400);
      const codigo = nuevoCodigo();
      const expira = new Date(Date.now() + 7 * 864e5).toISOString();
      const { error: e2 } = await svc.from("activaciones")
        .upsert({ email, codigo_hash: await sha256(codigo), expira, intentos: 0 });
      if (e2) throw e2;
      return res({ codigo, expira });
    }

    if (body.accion === "activar") {
      const codigo = String(body.codigo || "").trim().toUpperCase();
      const password = String(body.password || "");
      if (!email || !codigo) return res({ error: "Faltan correo o código" }, 400);
      if (password.length < 10) return res({ error: "La contraseña debe tener al menos 10 caracteres" }, 400);
      const { data: act } = await svc.from("activaciones").select("*").eq("email", email).maybeSingle();
      const malo = () => res({ error: "Correo o código incorrecto, o el código ya venció" }, 400);
      if (!act || new Date(act.expira) < new Date() || act.intentos >= 5) return malo();
      if ((await sha256(codigo)) !== act.codigo_hash) {
        await svc.from("activaciones").update({ intentos: act.intentos + 1 }).eq("email", email);
        return malo();
      }
      const existente = await buscarUsuario(email);
      if (existente) {
        const { error } = await svc.auth.admin.updateUserById(existente.id, { password, email_confirm: true });
        if (error) throw error;
      } else {
        const { error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) throw error;
      }
      await svc.from("activaciones").delete().eq("email", email);
      return res({ ok: true });
    }
    return res({ error: "Acción desconocida" }, 400);
  } catch (e) {
    console.error(e);
    return res({ error: "Error interno: " + ((e as Error)?.message || e) }, 500);
  }
});
