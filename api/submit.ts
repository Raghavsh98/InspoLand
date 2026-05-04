import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	const { url } = (req.body as { url?: unknown }) ?? {};

	if (typeof url !== "string" || url.trim() === "") {
		return res.status(400).json({ error: "Invalid URL" });
	}

	try {
		const parsed = new URL(url.trim());
		if (!["http:", "https:"].includes(parsed.protocol)) {
			return res.status(400).json({ error: "Only http and https URLs are accepted" });
		}
	} catch {
		return res.status(400).json({ error: "Invalid URL" });
	}

	const supabaseUrl = process.env.SUPABASE_URL;
	const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!supabaseUrl || !supabaseKey) {
		console.error("[submit] Missing Supabase env vars");
		return res.status(500).json({ error: "Server misconfiguration" });
	}

	const supabase = createClient(supabaseUrl, supabaseKey);

	const { error } = await supabase.from("submissions").insert({ url: url.trim() });

	if (error) {
		console.error("[submit] Supabase insert error", error);
		return res.status(500).json({ error: "Failed to save submission" });
	}

	return res.status(201).json({ ok: true });
}
