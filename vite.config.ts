import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createClient } from "@supabase/supabase-js";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");

	return {
		plugins: [
			react(),
			{
				name: "api-dev-middleware",
				configureServer(server) {
					server.middlewares.use(
						"/api/submit",
						(req, res, next) => {
							if (req.method !== "POST") return next();

							let body = "";
							req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
							req.on("end", async () => {
								res.setHeader("Content-Type", "application/json");
								try {
									const { url } = JSON.parse(body) as { url?: unknown };

									if (typeof url !== "string" || url.trim() === "") {
										res.statusCode = 400;
										res.end(JSON.stringify({ error: "Invalid URL" }));
										return;
									}

									try {
										const parsed = new URL(url.trim());
										if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
									} catch {
										res.statusCode = 400;
										res.end(JSON.stringify({ error: "Only http and https URLs are accepted" }));
										return;
									}

									const supabaseUrl = env.SUPABASE_URL;
									const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

									if (!supabaseUrl || !supabaseKey) {
										console.error("[api/submit dev] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
										res.statusCode = 500;
										res.end(JSON.stringify({ error: "Server misconfiguration" }));
										return;
									}

									const supabase = createClient(supabaseUrl, supabaseKey);
									const { error } = await supabase.from("submissions").insert({ url: url.trim() });

									if (error) {
										console.error("[api/submit dev] Supabase error", error);
										res.statusCode = 500;
										res.end(JSON.stringify({ error: "Failed to save submission" }));
										return;
									}

									res.statusCode = 201;
									res.end(JSON.stringify({ ok: true }));
								} catch (e) {
									console.error("[api/submit dev] Unexpected error", e);
									res.statusCode = 500;
									res.end(JSON.stringify({ error: "Server error" }));
								}
							});
						}
					);
				},
			},
		],
	};
});
