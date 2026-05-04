import * as THREE from "three";
import Stats from "stats-gl";
import { createRoot, type Root } from "react-dom/client";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as dat from "dat.gui";

import { ConsoleThemeToolbar } from "./ui/ConsoleThemeToolbar";
import { SceneTransportBar } from "./ui/SceneTransportBar";

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import { GrassMaterial } from "./GrassMaterial";
import { OrbSystem } from "./OrbSystem";
import { SkySystem } from "./SkySystem";
import { DEFAULT_SKY_TRANSITION_MS } from "./SkyToggle";
import { initScatterTextHero } from "./scatterTextHero";

export class FluffyGrass {
	// # Need access to these outside the comp
	private loadingManager: THREE.LoadingManager;
	private textureLoader: THREE.TextureLoader;
	private gltfLoader: GLTFLoader;

	private camera: THREE.PerspectiveCamera;
	private renderer: THREE.WebGLRenderer;
	private scene: THREE.Scene;
	private canvas: HTMLCanvasElement;
	private stats: Stats;
	private orbitControls: OrbitControls;
	private gui: dat.GUI;
	private sceneGUI: dat.GUI;
	private sceneProps = {
		fogColor: "#eeeeee",
		terrainColor: "#5e875e",
		fogDensity: 0.023934,
	};
	private textures: { [key: string]: THREE.Texture } = {};

	Uniforms = {
		uTime: { value: 0 },
		color: { value: new THREE.Color("#0000ff") },
	};
	private clock = new THREE.Clock();

	private terrainMat: THREE.MeshPhongMaterial;
	private grassGeometry = new THREE.BufferGeometry();
	private grassMaterial: GrassMaterial;
	private grassCount = 8000;
	private orbSystem: OrbSystem;
	private skySystem: SkySystem;

	private guiContainerEl: HTMLDivElement | null = null;
	private readonly guiThemeStorageKey = "fg-console-theme";
	/** Pill + sky mode (`N` / `M`) stay aligned: day ↔ light GUI, night ↔ dark GUI. */
	private applyGuiTheme: ((
		theme: "dark" | "light",
		persist: boolean,
		skipSkySync: boolean
	) => void) | null = null;
	private guiChordKeys = new Set<string>();
	private guiChordWasActive = false;
	private autoRotateGui?: dat.GUIController;
	private rotateMusic?: HTMLAudioElement;
	/** Independent of auto-rotate: only affects the rotate-mode background track. */
	private musicMuted = false;
	private transportReactRoot: Root | null = null;
	/** Opens the console toolbar URL row (same as top Plus / `A` shortcut). */
	private expandConsoleUrlSubmitRow: (() => void) | null = null;
	/** After orb opens an external link: resume play on tab return only if transport was playing before that pause. */
	private transportResumePlayAfterTabReturn = false;
	private orbExternalPauseActive = false;
	/** Non-null while a volume ramp (fade-in) is running; cleared when finished or cancelled. */
	private rotateMusicVolumeRampRafId: number | null = null;

	private onDocumentVisibilityChange = () => {
		if (document.visibilityState === "hidden") {
			this.cancelRotateMusicVolumeRamp();
			const audio = this.rotateMusic;
			if (audio && this.orbitControls.autoRotate) {
				audio.volume = FluffyGrass.ROTATE_MUSIC_TARGET_VOLUME;
			}
			return;
		}
		if (document.visibilityState !== "visible") {
			return;
		}
		if (!this.transportResumePlayAfterTabReturn) {
			return;
		}
		this.transportResumePlayAfterTabReturn = false;
		this.orbitControls.autoRotate = true;
		this.autoRotateGui?.updateDisplay();
		this.syncRotateMusic({ fadeIn: true });
		this.refreshTransportUi();
	};

	private static readonly ROTATE_MODE_MUSIC_URL =
		"https://res.cloudinary.com/dwf4f4ftl/video/upload/v1777800882/Static_Orchard_345_qqlbvv.mp3";
	private static readonly ROTATE_MUSIC_FADE_IN_MS = 1500;
	private static readonly ROTATE_MUSIC_TARGET_VOLUME = 1;

	constructor(_canvas: HTMLCanvasElement) {
		this.loadingManager = new THREE.LoadingManager();
		this.textureLoader = new THREE.TextureLoader(this.loadingManager);

		this.gui = new dat.GUI();

		this.gltfLoader = new GLTFLoader(this.loadingManager);

		this.canvas = _canvas;
		// this.canvas.style.pointerEvents = 'all';
		this.stats = new Stats({
			minimal: true,
		});

		this.camera = new THREE.PerspectiveCamera(
			75,
			window.innerWidth / window.innerHeight,
			0.1,
			1000
		);
		this.camera.position.set(21.43, 4.51, -7.31);
		this.scene = new THREE.Scene();
		this.scene.fog = new THREE.FogExp2(
			this.sceneProps.fogColor,
			this.sceneProps.fogDensity
		);

		this.renderer = new THREE.WebGLRenderer({
			canvas: this.canvas,
			antialias: true,
			alpha: false,
			precision: "highp", // Use high precision
		});
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.autoUpdate = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.scene.frustumCulled = true;
		this.skySystem = new SkySystem(this.scene, this.renderer, this.camera);

		this.orbitControls = new OrbitControls(this.camera, canvas);
		this.orbitControls.autoRotate = false;
		this.orbitControls.autoRotateSpeed = -0.5;
		this.orbitControls.enableDamping = true;
		// Disable mouse controls by default
		this.orbitControls.enablePan = false;
		this.orbitControls.enableRotate = false;
		this.orbitControls.enableZoom = false;

		this.grassMaterial = new GrassMaterial();
		this.terrainMat = new THREE.MeshPhongMaterial({
			color: this.sceneProps.terrainColor,
		});

		this.init();
	}

	private init() {
		this.setupTransportControls();
		this.setupGUI();
		this.setupStats();
		this.setupTextures();
		// this.createCube();
		this.loadModels();
		this.setupEventListeners();
		document.addEventListener("visibilitychange", this.onDocumentVisibilityChange);
	}

	private initRotateMusic(): HTMLAudioElement {
		if (this.rotateMusic) {
			this.rotateMusic.muted = this.musicMuted;
			return this.rotateMusic;
		}
		const audio = new Audio(FluffyGrass.ROTATE_MODE_MUSIC_URL);
		audio.loop = true;
		audio.preload = "none";
		audio.volume = FluffyGrass.ROTATE_MUSIC_TARGET_VOLUME;
		audio.muted = this.musicMuted;
		this.rotateMusic = audio;
		return audio;
	}

	private cancelRotateMusicVolumeRamp() {
		if (this.rotateMusicVolumeRampRafId !== null) {
			cancelAnimationFrame(this.rotateMusicVolumeRampRafId);
			this.rotateMusicVolumeRampRafId = null;
		}
	}

	private syncRotateMusic(opts?: { fadeIn?: boolean }) {
		const audio = this.orbitControls.autoRotate
			? this.initRotateMusic()
			: this.rotateMusic;
		if (!audio) {
			return;
		}
		audio.muted = this.musicMuted;
		if (this.orbitControls.autoRotate) {
			const useFadeIn = Boolean(opts?.fadeIn && !this.musicMuted);
			if (useFadeIn) {
				this.cancelRotateMusicVolumeRamp();
				audio.volume = 0;
				void audio.play().catch(() => {});
				const start = performance.now();
				const target = FluffyGrass.ROTATE_MUSIC_TARGET_VOLUME;
				const duration = FluffyGrass.ROTATE_MUSIC_FADE_IN_MS;
				const step = (now: number) => {
					if (this.rotateMusic !== audio) {
						this.rotateMusicVolumeRampRafId = null;
						return;
					}
					if (!this.orbitControls.autoRotate) {
						audio.volume = target;
						this.rotateMusicVolumeRampRafId = null;
						return;
					}
					if (this.musicMuted) {
						audio.volume = target;
						this.rotateMusicVolumeRampRafId = null;
						return;
					}
					const t = Math.min(1, (now - start) / duration);
					audio.volume = target * t;
					if (t < 1) {
						this.rotateMusicVolumeRampRafId = requestAnimationFrame(step);
					} else {
						audio.volume = target;
						this.rotateMusicVolumeRampRafId = null;
					}
				};
				this.rotateMusicVolumeRampRafId = requestAnimationFrame(step);
			} else {
				this.cancelRotateMusicVolumeRamp();
				audio.volume = FluffyGrass.ROTATE_MUSIC_TARGET_VOLUME;
				void audio.play().catch(() => {});
			}
		} else {
			this.cancelRotateMusicVolumeRamp();
			audio.volume = FluffyGrass.ROTATE_MUSIC_TARGET_VOLUME;
			audio.pause();
		}
	}

	private setupTransportControls() {
		const mount = document.getElementById("scene-transport-react-mount");
		if (!mount) {
			return;
		}
		this.transportReactRoot = createRoot(mount);
		this.refreshTransportUi();
	}

	private pauseTransportForOrbExternalOpen() {
		this.transportResumePlayAfterTabReturn = this.orbitControls.autoRotate;
		this.orbExternalPauseActive = true;
		try {
			this.orbitControls.autoRotate = false;
			this.autoRotateGui?.updateDisplay();
			this.syncRotateMusic();
			this.refreshTransportUi();
		} finally {
			this.orbExternalPauseActive = false;
		}
	}

	private toggleTransportPlay() {
		this.orbitControls.autoRotate = !this.orbitControls.autoRotate;
		if (!this.orbitControls.autoRotate) {
			this.transportResumePlayAfterTabReturn = false;
		}
		this.autoRotateGui?.updateDisplay();
		this.syncRotateMusic();
		this.refreshTransportUi();
	}

	/** Skip app shortcuts when typing or in native controls (incl. dat.GUI fields). */
	private shouldIgnoreKeyboardShortcut(event: KeyboardEvent): boolean {
		const t = event.target as HTMLElement | null;
		if (!t) {
			return false;
		}
		/* Transport icon buttons keep focus after mouse click; still honor P / S / etc. */
		if (t.closest(".scene-transport__icon-btn")) {
			return false;
		}
		if (t.isContentEditable || t.closest("[contenteditable='true']")) {
			return true;
		}
		if (t.closest('[role="textbox"]')) {
			return true;
		}
		const tag = t.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") {
			return true;
		}
		if (t.closest("button")) {
			return true;
		}
		if (this.gui?.domElement.contains(t)) {
			return Boolean(t.closest(".dg input, .dg textarea, .dg select"));
		}
		return false;
	}

	private letterShortcutModifiersClear(event: KeyboardEvent): boolean {
		return !event.metaKey && !event.ctrlKey && !event.altKey;
	}

	private toggleTransportMute() {
		this.musicMuted = !this.musicMuted;
		const audio = this.rotateMusic;
		if (audio) {
			audio.muted = this.musicMuted;
			if (this.musicMuted) {
				this.cancelRotateMusicVolumeRamp();
				audio.volume = FluffyGrass.ROTATE_MUSIC_TARGET_VOLUME;
			}
		}
		this.refreshTransportUi();
	}

	private refreshTransportUi() {
		const playing = this.orbitControls.autoRotate;
		this.transportReactRoot?.render(
			<SceneTransportBar
				playing={playing}
				muted={this.musicMuted}
				onTogglePlay={() => this.toggleTransportPlay()}
				onToggleMute={() => this.toggleTransportMute()}
			/>
		);
	}

	private createCube() {
		const geometry = new THREE.BoxGeometry(2, 7, 2);
		const material = new THREE.MeshPhongMaterial({ color: 0x333333 });
		const cube = new THREE.Mesh(geometry, material);
		cube.position.set(6, 5, -3);
		cube.castShadow = true;
		this.scene.add(cube);
	}

	private addGrass(
		surfaceMesh: THREE.Mesh,
		grassGeometry: THREE.BufferGeometry
	) {
		// Create a sampler for a Mesh surface.
		const sampler = new MeshSurfaceSampler(surfaceMesh)
			.setWeightAttribute("color")
			.build();

		// Create a material for grass
		const grassInstancedMesh = new THREE.InstancedMesh(
			grassGeometry,
			this.grassMaterial.material,
			this.grassCount
		);
		grassInstancedMesh.receiveShadow = true;

		const position = new THREE.Vector3();
		const quaternion = new THREE.Quaternion();
		const scale = new THREE.Vector3(1, 1, 1);

		const normal = new THREE.Vector3();
		const yAxis = new THREE.Vector3(0, 1, 0);
		const matrix = new THREE.Matrix4();

		// Sample randomly from the surface, creating an instance of the sample
		// geometry at each sample point.
		for (let i = 0; i < this.grassCount; i++) {
			sampler.sample(position, normal);

			// Align the instance with the surface normal
			quaternion.setFromUnitVectors(yAxis, normal);
			// Create a random rotation around the y-axis
			const randomRotation = new THREE.Euler(0, Math.random() * Math.PI * 2, 0);
			const randomQuaternion = new THREE.Quaternion().setFromEuler(
				randomRotation
			);

			// Combine the alignment with the random rotation
			quaternion.multiply(randomQuaternion);

			// Set the new scale in the matrix
			matrix.compose(position, quaternion, scale);

			grassInstancedMesh.setMatrixAt(i, matrix);
		}

		this.scene.add(grassInstancedMesh);
	}

	private loadModels() {
		this.sceneGUI
			.addColor(this.sceneProps, "terrainColor")
			.onChange((value) => {
				this.terrainMat.color.set(value);
			});

		const islandPromise = this.gltfLoader.loadAsync("/island.glb");
		const grassPromise = this.gltfLoader.loadAsync("/grassLODs.glb");

		void Promise.all([islandPromise, grassPromise])
			.then(([islandGltf, grassGltf]) => {
				let terrainMesh: THREE.Mesh | null = null;
				islandGltf.scene.traverse((child) => {
					if (child instanceof THREE.Mesh) {
						child.material = this.terrainMat;
						child.receiveShadow = true;
						child.geometry.scale(3, 3, 3);
						terrainMesh = child;
					}
				});
				if (!terrainMesh) {
					return;
				}
				this.scene.add(islandGltf.scene);

				grassGltf.scene.traverse((child) => {
					if (child instanceof THREE.Mesh) {
						if (child.name.includes("LOD00")) {
							child.geometry.scale(5, 5, 5);
							this.grassGeometry = child.geometry;
						}
					}
				});

				this.addGrass(terrainMesh, this.grassGeometry);
				
				// Initialize orb system after terrain is loaded
				this.orbSystem = new OrbSystem(
					this.scene,
					this.camera,
					terrainMesh,
					this.canvas,
					() => this.pauseTransportForOrbExternalOpen()
				);
			}).catch((error) => {
				console.error("Failed to load scene models", error);
			});


	}

	public render() {
		this.Uniforms.uTime.value += this.clock.getDelta();
		this.grassMaterial.update(this.Uniforms.uTime.value);
		this.skySystem.update();
		
		// Update orb system if initialized
		if (this.orbSystem) {
			this.orbSystem.update(Date.now());
			
			// Update grass material with orb lighting data
			const orbData = this.orbSystem.getSimpleOrbData();
			this.grassMaterial.updateOrbLighting(orbData.positions, orbData.intensities);
		}
		
		this.renderer.render(this.scene, this.camera);
		// this.postProcessingManager.update();
		this.stats.update();
		this.updateCameraPosition();
		requestAnimationFrame(() => this.render());
		this.orbitControls.update();
	}

	private setupTextures() {
		this.textures.perlinNoise = this.textureLoader.load("/perlinnoise.webp");

		this.textures.perlinNoise.wrapS = this.textures.perlinNoise.wrapT =
			THREE.RepeatWrapping;

		this.textures.grassAlpha = this.textureLoader.load("/grass.jpeg");

		this.grassMaterial.setupTextures(
			this.textures.grassAlpha,
			this.textures.perlinNoise
		);
	}

	private setupGUI() {
		this.gui.open();
		this.gui.width = 360;
		const guiContainer = this.gui.domElement.parentElement as HTMLDivElement;
		guiContainer.style.zIndex = "9999";
		guiContainer.style.position = "fixed";
		guiContainer.style.top = "0";
		guiContainer.style.left = "0";
		guiContainer.style.right = "auto";

		this.skySystem.setupGUI(this.gui);
		this.sceneGUI = this.gui.addFolder("Scene Properties");
		this.autoRotateGui = this.sceneGUI
			.add(this.orbitControls, "autoRotate")
			.name("Auto Rotate")
			.onChange(() => {
				this.syncRotateMusic();
				this.refreshTransportUi();
				if (!this.orbExternalPauseActive && !this.orbitControls.autoRotate) {
					this.transportResumePlayAfterTabReturn = false;
				}
			});
		this.sceneGUI
			.add(this.sceneProps, "fogDensity", 0, 0.05, 0.000001)
			.onChange((value) => {
				(this.scene.fog as THREE.FogExp2).density = value;
			});
		this.sceneGUI.addColor(this.sceneProps, "fogColor").onChange((value) => {
			this.scene.fog?.color.set(value);
			// Keep gradient sky background unchanged
		});

		this.grassMaterial.setupGUI(this.sceneGUI);

		this.sceneGUI.open();

		initScatterTextHero(this.gui);

		this.guiContainerEl = guiContainer;
		this.guiContainerEl.style.display = "none";
		this.setupGuiChordToggle();
		this.setupGuiThemeToggle(this.gui.domElement);
	}

	private setupGuiThemeToggle(panelRoot: HTMLElement) {
		document.documentElement.style.setProperty(
			"--console-theme-transition",
			`${DEFAULT_SKY_TRANSITION_MS}ms`
		);

		const mkToolbar = () => {
			const toolbar = document.createElement("div");
			toolbar.className = "gui-console-theme-toolbar";
			toolbar.setAttribute("role", "group");
			toolbar.setAttribute("aria-label", "Console color scheme");
			const reactMount = document.createElement("div");
			reactMount.className = "gui-console-theme-toolbar-react";
			toolbar.appendChild(reactMount);
			return { toolbar, reactMount };
		};

		const inPanel = mkToolbar();
		const floatingWrap = document.createElement("div");
		floatingWrap.className = "console-theme-floating";
		floatingWrap.setAttribute("role", "region");
		floatingWrap.setAttribute("aria-label", "Developer console appearance");
		const floating = mkToolbar();
		floating.toolbar.classList.add("gui-console-theme-toolbar--overlay");
		floatingWrap.appendChild(floating.toolbar);
		document.body.appendChild(floatingWrap);

		const inPanelRoot = createRoot(inPanel.reactMount);
		const floatingRoot = createRoot(floating.reactMount);

		let themeForToolbar: "dark" | "light" = "dark";
		let urlSubmitExpanded = false;
		let urlDraft = "";
		let urlSubmitState: import("./ui/ConsoleThemeToolbar").UrlSubmitState = "idle";
		let urlFeedbackMessage = "";

		const skyModeForGuiTheme = (theme: "dark" | "light") =>
			theme === "light" ? "day" : "night";

		let renderThemeToolbars: () => void;

		const collapseUrlSubmitRow = () => {
			urlSubmitExpanded = false;
			urlDraft = "";
			urlSubmitState = "idle";
			urlFeedbackMessage = "";
			renderThemeToolbars();
		};

		const requestUrlSubmitExpand = () => {
			if (!urlSubmitExpanded) {
				urlSubmitExpanded = true;
				urlSubmitState = "idle";
				renderThemeToolbars();
			}
		};

		const collapseUrlSubmitIfEmpty = () => {
			if (!urlSubmitExpanded || urlDraft.trim() !== "" || urlSubmitState !== "idle") return;
			collapseUrlSubmitRow();
		};

		const handleUrlSubmit = async (url: string) => {
			urlSubmitState = "submitting";
			renderThemeToolbars();
			try {
				const res = await fetch("/api/submit", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ url }),
				});
				if (res.ok) {
					urlFeedbackMessage = "Submitted for Approval!";
					urlSubmitState = "success";
					renderThemeToolbars();
					setTimeout(collapseUrlSubmitRow, 1000);
				} else {
					const body = await res.json().catch(() => ({})) as { error?: string };
					urlFeedbackMessage = body.error ?? "Failed to submit";
					urlSubmitState = "error";
					renderThemeToolbars();
					setTimeout(collapseUrlSubmitRow, 1000);
				}
			} catch {
				urlFeedbackMessage = "Failed to submit";
				urlSubmitState = "error";
				renderThemeToolbars();
				setTimeout(collapseUrlSubmitRow, 1000);
			}
		};

		const onPointerDownMaybeCollapseUrlRow = (e: PointerEvent) => {
			if (!urlSubmitExpanded || urlDraft.trim() !== "" || urlSubmitState !== "idle") return;
			const t = e.target;
			if (!(t instanceof Node)) return;
			for (const slot of document.querySelectorAll(".gui-console-theme-add-slot")) {
				if (slot.contains(t)) return;
			}
			collapseUrlSubmitIfEmpty();
		};
		document.addEventListener("pointerdown", onPointerDownMaybeCollapseUrlRow);

		renderThemeToolbars = () => {
			const toolbarProps = {
				theme: themeForToolbar,
				onToggle: () => this.skySystem.toggleMode(),
				urlSubmitExpanded,
				onRequestUrlSubmitExpand: requestUrlSubmitExpand,
				urlDraft,
				onUrlDraftChange: (value: string) => {
					urlDraft = value;
					renderThemeToolbars();
				},
				onSubmitUrl: handleUrlSubmit,
				onCollapseUrlRow: collapseUrlSubmitRow,
				submitState: urlSubmitState,
				feedbackMessage: urlFeedbackMessage,
			};
			inPanelRoot.render(
				<ConsoleThemeToolbar {...toolbarProps} autofocusUrlInput={false} />
			);
			floatingRoot.render(
				<ConsoleThemeToolbar {...toolbarProps} autofocusUrlInput={true} />
			);
		};

		this.expandConsoleUrlSubmitRow = requestUrlSubmitExpand;

		const apply = (theme: "dark" | "light", persist: boolean, skipSkySync: boolean) => {
			themeForToolbar = theme;
			panelRoot.classList.toggle("gui-theme-light", theme === "light");
			floatingWrap.classList.toggle("is-gui-theme-light", theme === "light");
			document.body.classList.toggle("gui-theme-light", theme === "light");
			renderThemeToolbars();
			if (persist) {
				try {
					localStorage.setItem(this.guiThemeStorageKey, theme);
				} catch {
					/* ignore quota / private mode */
				}
			}
			if (!skipSkySync) {
				this.skySystem.setMode(skyModeForGuiTheme(theme));
			}
		};

		this.applyGuiTheme = apply;

		let initial: "dark" | "light" = "dark";
		try {
			const stored = localStorage.getItem(this.guiThemeStorageKey);
			if (stored === "light" || stored === "dark") {
				initial = stored;
			}
		} catch {
			/* ignore */
		}
		apply(initial, false, true);
		this.skySystem.setMode(skyModeForGuiTheme(initial), 0);

		this.skySystem.setAfterToggleModeHandler(() => {
			const theme = this.skySystem.getMode() === "day" ? "light" : "dark";
			this.applyGuiTheme?.(theme, true, true);
		});

		panelRoot.style.position = "relative";
		panelRoot.appendChild(inPanel.toolbar);
	}

	private setupGuiChordToggle() {
		const syncChord = (e?: KeyboardEvent) => {
			const active = this.isGuiChordActive();
			if (active && !this.guiChordWasActive) {
				e?.preventDefault();
				e?.stopPropagation();
				this.toggleGuiContainer();
			}
			this.guiChordWasActive = active;
		};

		window.addEventListener(
			"keydown",
			(e) => {
				this.guiChordKeys.add(e.code);
				syncChord(e);
			},
			true
		);
		window.addEventListener(
			"keyup",
			(e) => {
				this.guiChordKeys.delete(e.code);
				syncChord();
			},
			true
		);
	}

	private isGuiChordActive(): boolean {
		const p = this.guiChordKeys;
		return (
			(p.has("MetaLeft") || p.has("MetaRight")) &&
			(p.has("ShiftLeft") || p.has("ShiftRight")) &&
			p.has("KeyR") &&
			p.has("KeyS")
		);
	}

	private toggleGuiContainer() {
		if (!this.guiContainerEl) {
			return;
		}
		const hidden = this.guiContainerEl.style.display === "none";
		this.guiContainerEl.style.display = hidden ? "block" : "none";
	}

	private setupStats() {
		this.stats.init(this.renderer);
		// Commented out due to TypeScript errors with private dom property
		// this.stats.dom.style.bottom = "45px";
		// this.stats.dom.style.top = "auto";
		// this.stats.dom.style.left = "auto";
		// this.stats.dom.style.display = "none";
		// document.body.appendChild(this.stats.dom);
	}

	private setupEventListeners() {
		window.addEventListener("resize", () => this.setAspectResolution(), false);
		/* App shortcuts: P play/pause, S mute/unmute, A open URL row on console toolbar, M/N sky+GUI theme. */
		window.addEventListener("keydown", (event) => {
			if (this.shouldIgnoreKeyboardShortcut(event)) {
				return;
			}

			const key = event.key.toLowerCase();

			if (!this.letterShortcutModifiersClear(event)) {
				return;
			}

			if (key === "p") {
				if (event.repeat) {
					return;
				}
				event.preventDefault();
				this.toggleTransportPlay();
				return;
			}

			if (key === "n" || key === "m") {
				event.preventDefault();
				this.skySystem.toggleMode();
				return;
			}
			if (key === "s") {
				event.preventDefault();
				this.toggleTransportMute();
				return;
			}
			if (key === "a") {
				event.preventDefault();
				this.expandConsoleUrlSubmitRow?.();
				return;
			}
		});

		// Commented out due to TypeScript errors with private dom property
		// this.stats.dom.addEventListener("click", () => {
		// 	console.log(this.renderer.info.render);
		// });



		// const randomizeGrassColor = document.querySelector(
		// 	".randomizeButton"
		// ) as HTMLButtonElement;
		// randomizeGrassColor.addEventListener("click", () => {
		// 	this.randomizeGrassColor();
		// });
	}

	private setAspectResolution() {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();

		this.renderer.setSize(window.innerWidth, window.innerHeight);
		// this.postProcessingManager.composer.setSize(
		// 	window.innerWidth,
		// 	window.innerHeight,
		// );
	}

	private updateCameraPosition() {
		const cameraX = document.getElementById('camera-x');
		const cameraY = document.getElementById('camera-y');
		const cameraZ = document.getElementById('camera-z');
		
		if (cameraX && cameraY && cameraZ) {
			cameraX.textContent = this.camera.position.x.toFixed(2);
			cameraY.textContent = this.camera.position.y.toFixed(2);
			cameraZ.textContent = this.camera.position.z.toFixed(2);
		}
	}





	private randomizeGrassColor() {
		const randomTipColorGenerator = () => {
			const r = Math.random();
			const g = Math.random();
			const b = Math.random();
			return new THREE.Color(r, g, b);
		};
		const randomColorGenerator = () => {
			// generate random color and keep it dark
			const r = Math.random() * 0.5;
			const g = Math.random() * 0.5;
			const b = Math.random() * 0.5;
			return new THREE.Color(r, g, b);
		};
		// find new terrain color, grass base and tip1,tip2 colors randomly
		const terrainColor = randomColorGenerator();
		const grassTip1Color = randomTipColorGenerator();
		const grassTip2Color = randomTipColorGenerator();
		this.terrainMat.color = terrainColor;
		this.grassMaterial.uniforms.baseColor.value = terrainColor;
		this.grassMaterial.uniforms.tipColor1.value = grassTip1Color;
		this.grassMaterial.uniforms.tipColor2.value = grassTip2Color;
	}
}

const canvas = document.querySelector("#canvas") as HTMLCanvasElement;
const app = new FluffyGrass(canvas);
app.render();
