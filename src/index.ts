import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";

const app = new Hono();
const sql = neon(process.env.DATABASE_URL!);

// Minimal HTML escape for security
const escapeHtml = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]!));

// Serve static HTML form
app.get("/", (c) =>
	c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Shortener Form</title>
<style>
body{font-family:Arial,sans-serif;background:#f4f4f4;display:flex;justify-content:center;align-items:center;height:100vh;}
form{display:flex;background:#fff;padding:10px;border-radius:6px;box-shadow:0 2px 5px rgba(0,0,0,0.2);}
input[type=text]{padding:10px;font-size:16px;border:1px solid #ccc;border-radius:4px 0 0 4px;outline:none;width:300px;}
button{padding:10px 20px;font-size:16px;border:none;background:#007BFF;color:#fff;border-radius:0 4px 4px 0;cursor:pointer;transition:background 0.3s;}
button:hover{background:#0056b3;}
</style>
</head>
<body>
<form id="shortForm" action="/api/short" method="POST">
<input type="text" name="url" id="urlInput" placeholder="Enter your URL here" required>
<button type="submit">Shorten</button>
</form>
<script>
document.getElementById('shortForm').addEventListener('submit', function(e){
const url=document.getElementById('urlInput').value.trim();
if(!/^https?:\/\/[\w.-]+(\.[\w\.-]+)+[\w\-._~:/?#[\]@!$&'()*+,;=]*$/i.test(url)){
e.preventDefault();alert("Please enter a valid URL (must start with http:// or https://).");return false;}
});
</script>
</body>
</html>`)
);

// Create or retrieve short URL
app.post("/api/short", async (c) => {
	const body = await c.req.parseBody();
	const url = body?.url;
	if (!url || typeof url !== "string") return c.text("Invalid URL", 400);

	try {
		// Use UPSERT to avoid double query
		const shortId = nanoid(6);
		const result = await sql`
			INSERT INTO urls (short_id, original_url) 
			VALUES (${shortId}, ${url}) 
			ON CONFLICT (original_url) DO UPDATE SET short_id=urls.short_id 
			RETURNING short_id
		`;
		const finalShortId = result[0].short_id;

		const protocol = c.req.header("Protocol") || "http";
		const host = c.req.header("Host");
		const shortUrl = `${protocol}://${host}/${finalShortId}`;

		return c.html(`<div style="font-family:Arial,sans-serif;max-width:600px;margin:50px auto;padding:20px;border:1px solid #ccc;border-radius:10px;text-align:center;box-shadow:2px 2px 12px rgba(0,0,0,0.1);">
<h2>URL Shortened Successfully!</h2>
<p><strong>Original:</strong> <a href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</a></p>
<p><strong>Shortened:</strong> <a href="${escapeHtml(shortUrl)}" target="_blank" id="short-url">${escapeHtml(shortUrl)}</a></p>
<button onclick="navigator.clipboard.writeText(document.getElementById('short-url').href).then(()=>alert('Copied!')).catch(err=>alert('Failed: '+err))" style="padding:10px 20px;font-weight:700;background:#007BFF;color:#fff;border:none;border-radius:5px;cursor:pointer;">Copy Short URL</button>
<br><br>
<a href="/" style="color:#007BFF;text-decoration:none;">Back</a>
</div>`);
	} catch (err) {
		console.error("DB error:", err);
		return c.text("Internal server error", 500);
	}
});

// Redirect short URL
app.get("/:id", async (c) => {
	const id = c.req.param("id");
	try {
		const rows = await sql`SELECT original_url FROM urls WHERE short_id = ${id} LIMIT 1`;
		if (!rows.length) return c.text("URL not found", 404);
		return c.redirect(rows[0].original_url);
	} catch (err) {
		console.error(err);
		return c.text("Internal server error", 500);
	}
});

export default app;
