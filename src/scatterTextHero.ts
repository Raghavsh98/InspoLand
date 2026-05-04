import type { GUI } from "dat.gui";

/** Landing motion: enter → hold → exit (see `runScatterHeroIntroMotion`). */
const SCATTER_HERO_START_DELAY_MS = 1700;
const SCATTER_HERO_ENTER_MS = 1000;
const SCATTER_HERO_HOLD_MS = 1500;
const SCATTER_HERO_EXIT_MS = 500;
const SCATTER_HERO_SLIDE_PX = 72;

function runScatterHeroIntroMotion(
	root: HTMLElement,
	onExitComplete: () => void
): void {
	const wrap = root.querySelector(".scatter-text-hero__wrap");
	if (!(wrap instanceof HTMLElement)) return;

	const reduced = window.matchMedia(
		"(prefers-reduced-motion: reduce)"
	).matches;

	wrap.style.opacity = "0";
	if (!reduced) {
		wrap.style.transform = `translateY(${SCATTER_HERO_SLIDE_PX}px)`;
	}

	const startEnter = () => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				wrap.style.transition = reduced
					? `opacity ${SCATTER_HERO_ENTER_MS}ms ease-out`
					: `opacity ${SCATTER_HERO_ENTER_MS}ms ease-out, transform ${SCATTER_HERO_ENTER_MS}ms ease-out`;
				wrap.style.opacity = "1";
				if (!reduced) {
					wrap.style.transform = "translateY(0)";
				}
			});
		});

		const t0 =
			SCATTER_HERO_START_DELAY_MS +
			SCATTER_HERO_ENTER_MS +
			SCATTER_HERO_HOLD_MS;
		window.setTimeout(() => {
			wrap.style.transition = `opacity ${SCATTER_HERO_EXIT_MS}ms ease-out`;
			wrap.style.opacity = "0";
		}, t0);

		window.setTimeout(() => {
			wrap.style.transition = "";
			root.style.display = "none";
			onExitComplete();
		}, t0 + SCATTER_HERO_EXIT_MS);
	};

	if (SCATTER_HERO_START_DELAY_MS > 0) {
		window.setTimeout(startEnter, SCATTER_HERO_START_DELAY_MS);
	} else {
		startEnter();
	}
}

/** Match layout tweaks (stacked headline on small screens). */
const SCATTER_HERO_MOBILE_MAX_WIDTH_PX = 768;

function isScatterHeroMobileLayout(): boolean {
	return window.matchMedia(
		`(max-width: ${SCATTER_HERO_MOBILE_MAX_WIDTH_PX}px)`
	).matches;
}

/** Desktop: single line unless the string contains newlines. Mobile: split words onto lines (two-word title → one word per line). */
export function getScatterHeroLines(raw: string): string[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];

	if (trimmed.includes("\n")) {
		return trimmed
			.split(/\n+/)
			.map((s) => s.trim())
			.filter(Boolean);
	}

	if (!isScatterHeroMobileLayout()) {
		return [trimmed.replace(/\s+/g, " ")];
	}

	const words = trimmed.split(/\s+/).filter(Boolean);
	if (words.length <= 1) return words;
	if (words.length === 2) return words;
	const mid = Math.ceil(words.length / 2);
	return [
		words.slice(0, mid).join(" "),
		words.slice(mid).join(" "),
	];
}

/** Fixed raster bloom; not exposed in GUI. */
const LOCKED_BLOOM_PX = 2.5;
const LOCKED_INNER_SPREAD_PX = 4.5;

function rasterPaddingPx(scatterRadius: number): number {
	const glowReach = LOCKED_INNER_SPREAD_PX + LOCKED_BLOOM_PX * 2.25 + 8;
	return Math.ceil(glowReach + scatterRadius * 2 + 56);
}

export const scatterTextHeroDefaults = {
	text: "Inspiration Lands",
	scatterRadius: 2,
	pixelSize: 1,
	speed: 0.2,
	canvasW: 1400,
	canvasH: 720,
	fontSize: 160,
	fontFamily: '"Connection III", "Orbitron", sans-serif',
};

export type ScatterTextHeroParams = typeof scatterTextHeroDefaults;

const VERT = `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;
void main() {
  v_texCoord  = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

in  vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_textTexture;
uniform float     u_time;
uniform float     u_scatterRadius;
uniform float     u_pixelSize;
uniform vec2      u_resolution;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  float bs    = max(u_pixelSize, 1.0);
  vec2  blkPx = floor(v_texCoord * u_resolution / bs) * bs + bs * 0.5;
  vec2  blkUV = blkPx / u_resolution;

  float r1     = hash(blkUV * 3.14159 + u_time * 0.07);
  float r2     = hash(blkUV * 2.71828 + u_time * 0.11);
  float angle  = r1 * 6.28318530718;
  float dist   = sqrt(r2) * u_scatterRadius;
  vec2  jitter = vec2(cos(angle), sin(angle)) * dist / u_resolution;

  vec2  fragPx = v_texCoord * u_resolution;
  vec2  rel    = (fragPx - blkPx) / max(bs * 0.5, 0.5);
  float circle = smoothstep(1.0, 0.3, length(rel));

  float alpha = texture(u_textTexture, clamp(blkUV + jitter, 0.0, 1.0)).a;
  fragColor   = vec4(1.0, 1.0, 1.0, alpha * circle);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
	const s = gl.createShader(type);
	if (!s) return null;
	gl.shaderSource(s, src);
	gl.compileShader(s);
	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
		console.warn("[scatterTextHero]", gl.getShaderInfoLog(s));
		gl.deleteShader(s);
		return null;
	}
	return s;
}

function link(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string) {
	const v = compile(gl, gl.VERTEX_SHADER, vsSrc);
	const f = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
	if (!v || !f) return null;
	const p = gl.createProgram();
	if (!p) return null;
	gl.attachShader(p, v);
	gl.attachShader(p, f);
	gl.linkProgram(p);
	gl.deleteShader(v);
	gl.deleteShader(f);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
		console.warn("[scatterTextHero]", gl.getProgramInfoLog(p));
		gl.deleteProgram(p);
		return null;
	}
	return p;
}

function stripFamilyQuotes(family: string): string {
	const t = family.trim();
	if (
		(t.startsWith('"') && t.endsWith('"')) ||
		(t.startsWith("'") && t.endsWith("'"))
	) {
		return t.slice(1, -1);
	}
	return t.split(",")[0]?.replace(/^["']|["']$/g, "").trim() ?? "Connection III";
}

/**
 * Full-viewport centered scatter-text overlay (WebGL2). Exposes CONFIG-style fields in dat.GUI.
 */
export function initScatterTextHero(gui: GUI): void {
	const root = document.getElementById("scatter-text-hero");
	const canvas = document.getElementById(
		"scatter-text-canvas"
	) as HTMLCanvasElement | null;
	if (!root || !canvas) return;

	if (window.self !== window.top) {
		root.style.display = "none";
		return;
	}

	const gl = canvas.getContext("webgl2", {
		alpha: true,
		premultipliedAlpha: false,
	}) as WebGL2RenderingContext | null;
	if (!gl) {
		console.warn("[scatterTextHero] WebGL2 not available");
		root.style.display = "none";
		return;
	}

	const prog = link(gl, VERT, FRAG);
	if (!prog) {
		root.style.display = "none";
		return;
	}

	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
		gl.STATIC_DRAW
	);

	const tex = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	const params: ScatterTextHeroParams = { ...scatterTextHeroDefaults };

	function syncCanvasSize() {
		const W = Math.max(16, Math.floor(params.canvasW));
		const H = Math.max(16, Math.floor(params.canvasH));
		ensureHeroTextureSize(W, H);
	}

	function ensureHeroTextureSize(nextW: number, nextH: number) {
		const w = Math.max(16, Math.floor(nextW));
		const h = Math.max(16, Math.floor(nextH));
		if (canvas.width === w && canvas.height === h) return;
		canvas.width = w;
		canvas.height = h;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	}

	function uploadText() {
		const lines = getScatterHeroLines(params.text);
		if (lines.length === 0) return;

		const lineHeight = params.fontSize * 1.22;
		const measureCanvas = document.createElement("canvas");
		const measureCtx = measureCanvas.getContext("2d");
		if (!measureCtx) return;
		measureCtx.font = `${params.fontSize}px ${params.fontFamily}`;

		let maxW = 0;
		for (const line of lines) {
			maxW = Math.max(maxW, measureCtx.measureText(line).width);
		}
		const textBlockH = lines.length * lineHeight;
		const pad = rasterPaddingPx(params.scatterRadius);
		const needW = Math.ceil(maxW + pad * 2);
		const needH = Math.ceil(textBlockH + pad * 2);

		const W = Math.max(needW, Math.floor(params.canvasW));
		const H = Math.max(needH, Math.floor(params.canvasH));

		ensureHeroTextureSize(W, H);

		const c = document.createElement("canvas");
		c.width = W;
		c.height = H;
		const ctx = c.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, W, H);
		ctx.font = `${params.fontSize}px ${params.fontFamily}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";

		const cx = W / 2;
		const cy = H / 2;

		function drawLinesWhite() {
			let y = cy - textBlockH / 2 + lineHeight / 2;
			for (const line of lines) {
				ctx.fillText(line, cx, y);
				y += lineHeight;
			}
		}

		if (LOCKED_INNER_SPREAD_PX > 0) {
			ctx.save();
			ctx.filter = `blur(${LOCKED_INNER_SPREAD_PX}px)`;
			ctx.globalCompositeOperation = "source-over";
			ctx.fillStyle = "#ffffff";
			drawLinesWhite();
			ctx.restore();
		}

		const bloom = Math.max(0, LOCKED_BLOOM_PX);
		if (bloom > 0) {
			ctx.save();
			ctx.filter = `blur(${bloom * 2.25}px)`;
			ctx.globalAlpha = 0.42;
			ctx.fillStyle = "#ffffff";
			drawLinesWhite();
			ctx.restore();

			ctx.save();
			ctx.filter = `blur(${bloom}px)`;
			ctx.globalAlpha = 1;
			ctx.fillStyle = "#ffffff";
			drawLinesWhite();
			ctx.restore();
		}

		ctx.globalAlpha = 1;
		ctx.filter = "none";
		ctx.globalCompositeOperation = "source-over";
		ctx.fillStyle = "#ffffff";
		drawLinesWhite();

		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
	}

	const uloc = {
		u_textTexture: gl.getUniformLocation(prog, "u_textTexture"),
		u_time: gl.getUniformLocation(prog, "u_time"),
		u_scatterRadius: gl.getUniformLocation(prog, "u_scatterRadius"),
		u_pixelSize: gl.getUniformLocation(prog, "u_pixelSize"),
		u_resolution: gl.getUniformLocation(prog, "u_resolution"),
	};
	const aloc = gl.getAttribLocation(prog, "a_position");

	function drawQuad() {
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.enableVertexAttribArray(aloc);
		gl.vertexAttribPointer(aloc, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	let raf = 0;
	let loopStarted = false;

	function render(t: number) {
		const W = canvas.width;
		const H = canvas.height;
		gl.viewport(0, 0, W, H);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.enable(gl.BLEND);
		gl.blendFuncSeparate(
			gl.SRC_ALPHA,
			gl.ONE_MINUS_SRC_ALPHA,
			gl.ONE,
			gl.ONE_MINUS_SRC_ALPHA
		);

		gl.useProgram(prog);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.uniform1i(uloc.u_textTexture, 0);
		gl.uniform1f(uloc.u_time, t * 0.001 * params.speed);
		gl.uniform1f(uloc.u_scatterRadius, params.scatterRadius);
		gl.uniform1f(uloc.u_pixelSize, params.pixelSize);
		gl.uniform2f(uloc.u_resolution, W, H);
		drawQuad();

		raf = requestAnimationFrame(render);
	}

	function startLoopIfNeeded() {
		if (!loopStarted) {
			loopStarted = true;
			raf = requestAnimationFrame(render);
		}
	}

	function scheduleRasterReload() {
		syncCanvasSize();
		const primary = stripFamilyQuotes(params.fontFamily);
		void document.fonts
			.load(`${params.fontSize}px ${primary}`)
			.catch(() => undefined)
			.finally(() => {
				uploadText();
				startLoopIfNeeded();
			});
	}

	scheduleRasterReload();

	let resizeDebounce = 0;
	function onWindowResize() {
		window.clearTimeout(resizeDebounce);
		resizeDebounce = window.setTimeout(() => scheduleRasterReload(), 120);
	}
	window.addEventListener("resize", onWindowResize);

	runScatterHeroIntroMotion(root, () => {
		cancelAnimationFrame(raf);
	});

	const folder = gui.addFolder("Hero text (scatter)");
	folder
		.add(params, "text")
		.name("Text")
		.onFinishChange(() => scheduleRasterReload());
	folder
		.add(params, "scatterRadius", 0, 48, 0.25)
		.name("Scatter radius");
	folder.add(params, "pixelSize", 1, 16, 0.5).name("Pixel size");
	folder.add(params, "speed", 0, 2, 0.01).name("Speed");
	folder
		.add(params, "canvasW", 256, 3072, 1)
		.name("Canvas W")
		.onFinishChange(() => scheduleRasterReload());
	folder
		.add(params, "canvasH", 128, 1280, 1)
		.name("Canvas H")
		.onFinishChange(() => scheduleRasterReload());
	folder
		.add(params, "fontSize", 24, 220, 1)
		.name("Font size")
		.onFinishChange(() => scheduleRasterReload());
	folder
		.add(params, "fontFamily")
		.name("Font family")
		.onFinishChange(() => scheduleRasterReload());
	folder.open();

	const onHide = () => {
		window.removeEventListener("resize", onWindowResize);
		window.clearTimeout(resizeDebounce);
		cancelAnimationFrame(raf);
		gl.deleteTexture(tex);
		gl.deleteBuffer(buf);
		gl.deleteProgram(prog);
	};
	window.addEventListener("pagehide", onHide);
}
