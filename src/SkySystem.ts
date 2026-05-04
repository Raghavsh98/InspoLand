import * as THREE from "three";
import * as dat from "dat.gui";
import {
	DEFAULT_SKY_ATMOSPHERE_SETTINGS,
	SkyAtmosphere,
	SkyAtmosphereSettings,
} from "./SkyAtmosphere";
import {
	DEFAULT_SKY_TRANSITION_MS,
	SkyToggle,
	SkyTransitionState,
} from "./SkyToggle";

export type SkyMode = "day" | "night";

const directionFromAzimuthElevation = (azimuth: number, elevation: number) => {
	const azimuthRad = THREE.MathUtils.degToRad(azimuth);
	const elevationRad = THREE.MathUtils.degToRad(elevation);
	const horizontal = Math.cos(elevationRad);

	return new THREE.Vector3(
		Math.cos(azimuthRad) * horizontal,
		Math.sin(elevationRad),
		Math.sin(azimuthRad) * horizontal
	).normalize();
};

const directionToAzimuthElevation = (direction: THREE.Vector3) => {
	const normalized = direction.clone().normalize();
	return {
		sunAzimuth: THREE.MathUtils.radToDeg(Math.atan2(normalized.z, normalized.x)),
		sunElevation: THREE.MathUtils.radToDeg(Math.asin(normalized.y)),
	};
};

const DAY_STATE: SkyTransitionState = {
	sunDirection: new THREE.Vector3(1.0, 0.6, 0.3).normalize(),
	directionalLightIntensity: 2.0,
	directionalLightColor: new THREE.Color("#ffffff"),
	ambientLightIntensity: 0.5,
	ambientLightColor: new THREE.Color("#ffffff"),
	fogDensity: 0.023934,
	fogColor: new THREE.Color("#e9eef0"),
	exposure: 0.8,
};

const NIGHT_SUN_ELEVATION_DEG =
	directionToAzimuthElevation(
		new THREE.Vector3(
			0.5019867794486782,
			-0.14055629824562993,
			0.853377525062753
		).normalize()
	).sunElevation;

const NIGHT_STATE: SkyTransitionState = {
	sunDirection: directionFromAzimuthElevation(
		116,
		NIGHT_SUN_ELEVATION_DEG
	),
	directionalLightIntensity: 0.05,
	directionalLightColor: new THREE.Color("#b8c8ff"),
	ambientLightIntensity: 0.12,
	ambientLightColor: new THREE.Color("#1a2a4a"),
	fogDensity: 0.028,
	fogColor: new THREE.Color("#02070a"),
	exposure: 0.35,
};

const SKY_STATES: Record<SkyMode, SkyTransitionState> = {
	day: DAY_STATE,
	night: NIGHT_STATE,
};

const colorToHex = (color: THREE.Color) => `#${color.getHexString()}`;

type SkyControlValues = SkyAtmosphereSettings & {
	sunAzimuth: number;
	sunElevation: number;
	exposure: number;
	directionalLightIntensity: number;
	directionalLightColor: string;
	ambientLightIntensity: number;
	ambientLightColor: string;
	fogDensity: number;
	fogColor: string;
	toggleDayNight: () => void;
	copyJSON: () => void;
};

export class SkySystem {
	public readonly ambientLight: THREE.AmbientLight;
	public readonly directionalLight: THREE.DirectionalLight;

	private readonly scene: THREE.Scene;
	private readonly renderer: THREE.WebGLRenderer;
	private readonly camera: THREE.Camera;
	private readonly skyScene = new THREE.Scene();
	private readonly cubeTarget: THREE.WebGLCubeRenderTarget;
	private readonly cubeCamera: THREE.CubeCamera;
	private readonly atmosphere = new SkyAtmosphere();
	private readonly pmremGenerator: THREE.PMREMGenerator;
	private readonly toggle: SkyToggle;
	private environmentTarget?: THREE.WebGLRenderTarget;
	private mode: SkyMode = "day";
	private guiControllers: dat.GUIController[] = [];
	private controls: SkyControlValues = this.createControlValues(DAY_STATE);
	/** Invoked after `toggleMode()` completes (keyboard / GUI), not after `setMode` (pill / init). */
	private afterToggleMode?: () => void;

	constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
		this.scene = scene;
		this.renderer = renderer;
		this.camera = camera;
		this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
		this.directionalLight = this.createDirectionalLight();

		this.scene.background = null;
		this.scene.add(this.atmosphere.backgroundMesh);
		this.scene.add(this.ambientLight);
		this.scene.add(this.directionalLight);

		this.skyScene.add(this.atmosphere.mesh);

		this.cubeTarget = new THREE.WebGLCubeRenderTarget(256, {
			type: THREE.HalfFloatType,
			format: THREE.RGBAFormat,
			generateMipmaps: false,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
		});
		this.cubeTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
		this.cubeCamera = new THREE.CubeCamera(0.1, 100, this.cubeTarget);
		this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
		this.pmremGenerator.compileCubemapShader();

		this.toggle = new SkyToggle(DAY_STATE, (state) => this.applyState(state));
		this.applyState(DAY_STATE);
		this.bake(true);
	}

	public getMode(): SkyMode {
		return this.mode;
	}

	public setAfterToggleModeHandler(handler?: () => void) {
		this.afterToggleMode = handler;
	}

	public toggleMode() {
		this.mode = this.mode === "day" ? "night" : "day";
		this.toggle.toggle(SKY_STATES[this.mode], DEFAULT_SKY_TRANSITION_MS);
		this.syncControlsFromState(SKY_STATES[this.mode]);
		this.afterToggleMode?.();
	}

	public setMode(mode: SkyMode, durationMs = DEFAULT_SKY_TRANSITION_MS) {
		this.mode = mode;
		this.toggle.toggle(SKY_STATES[this.mode], durationMs);
		this.syncControlsFromState(SKY_STATES[this.mode]);
	}

	public update() {
		this.atmosphere.backgroundMesh.position.copy(this.camera.position);
		const changed = this.toggle.update();

		if (changed) {
			this.bake(true);
		}
	}

	public dispose() {
		this.atmosphere.dispose();
		this.cubeTarget.dispose();
		this.environmentTarget?.dispose();
		this.pmremGenerator.dispose();
	}

	public setupGUI(gui: dat.GUI) {
		const skyFolder = gui.addFolder("Sky Controls");
		const sunFolder = skyFolder.addFolder("Sun + Horizon");
		const atmosphereFolder = skyFolder.addFolder("Atmosphere");
		const lightingFolder = skyFolder.addFolder("Lighting + Fog");
		const paletteFolder = skyFolder.addFolder("Palette");
		const actionsFolder = skyFolder.addFolder("Actions");

		this.addController(sunFolder, this.controls, "sunAzimuth", -180, 180, 0.1)
			.name("Sun Azimuth")
			.onChange(() => this.applyControls());
		this.addController(sunFolder, this.controls, "sunElevation", -45, 80, 0.1)
			.name("Sun Elevation")
			.onChange(() => this.applyControls());
		this.addController(sunFolder, this.controls, "horizonOffset", -0.5, 0.5, 0.001)
			.name("Horizon Offset")
			.onChange(() => this.applyControls());

		this.addController(atmosphereFolder, this.controls, "sunIntensity", 0, 80, 0.1)
			.name("Sun Intensity")
			.onChange(() => this.applyControls());
		this.addController(atmosphereFolder, this.controls, "rayleighStrength", 0, 20, 0.1)
			.name("Rayleigh")
			.onChange(() => this.applyControls());
		this.addController(atmosphereFolder, this.controls, "mieStrength", 0, 40, 0.1)
			.name("Mie")
			.onChange(() => this.applyControls());
		this.addController(atmosphereFolder, this.controls, "ozoneStrength", 0, 30, 0.1)
			.name("Ozone")
			.onChange(() => this.applyControls());
		this.addController(atmosphereFolder, this.controls, "skyMultiplier", 0, 8, 0.01)
			.name("Sky Mult")
			.onChange(() => this.applyControls());
		this.addController(atmosphereFolder, this.controls, "daySkyStrength", 0, 4, 0.01)
			.name("Day Strength")
			.onChange(() => this.applyControls());
		this.addController(atmosphereFolder, this.controls, "nightSkyStrength", 0, 4, 0.01)
			.name("Night Strength")
			.onChange(() => this.applyControls());
		this.addController(atmosphereFolder, this.controls, "twilightStrength", 0, 4, 0.01)
			.name("Twilight")
			.onChange(() => this.applyControls());
		this.addController(atmosphereFolder, this.controls, "twilightAmberStrength", 0, 4, 0.01)
			.name("Amber Glow")
			.onChange(() => this.applyControls());
		this.addController(atmosphereFolder, this.controls, "twilightRoseStrength", 0, 4, 0.01)
			.name("Rose Glow")
			.onChange(() => this.applyControls());

		this.addController(lightingFolder, this.controls, "exposure", 0, 2, 0.01)
			.name("Exposure")
			.onChange(() => this.applyControls());
		this.addController(lightingFolder, this.controls, "directionalLightIntensity", 0, 5, 0.01)
			.name("Sun Light")
			.onChange(() => this.applyControls());
		this.addColorController(lightingFolder, this.controls, "directionalLightColor")
			.name("Sun Color")
			.onChange(() => this.applyControls());
		this.addController(lightingFolder, this.controls, "ambientLightIntensity", 0, 2, 0.01)
			.name("Ambient")
			.onChange(() => this.applyControls());
		this.addColorController(lightingFolder, this.controls, "ambientLightColor")
			.name("Ambient Color")
			.onChange(() => this.applyControls());
		this.addController(lightingFolder, this.controls, "fogDensity", 0, 0.08, 0.0001)
			.name("Fog Density")
			.onChange(() => this.applyControls());
		this.addColorController(lightingFolder, this.controls, "fogColor")
			.name("Fog Color")
			.onChange(() => this.applyControls());

		this.addColorController(paletteFolder, this.controls, "dayHorizonColor")
			.name("Day Horizon")
			.onChange(() => this.applyControls());
		this.addColorController(paletteFolder, this.controls, "dayZenithColor")
			.name("Day Zenith")
			.onChange(() => this.applyControls());
		this.addColorController(paletteFolder, this.controls, "nightHorizonColor")
			.name("Night Horizon")
			.onChange(() => this.applyControls());
		this.addColorController(paletteFolder, this.controls, "nightZenithColor")
			.name("Night Zenith")
			.onChange(() => this.applyControls());
		this.addColorController(paletteFolder, this.controls, "twilightLowColor")
			.name("Twilight Low")
			.onChange(() => this.applyControls());
		this.addColorController(paletteFolder, this.controls, "twilightHighColor")
			.name("Twilight High")
			.onChange(() => this.applyControls());
		this.addColorController(paletteFolder, this.controls, "twilightAmberColor")
			.name("Amber Color")
			.onChange(() => this.applyControls());
		this.addColorController(paletteFolder, this.controls, "twilightRoseColor")
			.name("Rose Color")
			.onChange(() => this.applyControls());

		actionsFolder.add(this.controls, "toggleDayNight").name("Toggle Day/Night");
		actionsFolder.add(this.controls, "copyJSON").name("Copy JSON");

		skyFolder.open();
		sunFolder.open();
		atmosphereFolder.open();
		lightingFolder.open();
		actionsFolder.open();
	}

	private createDirectionalLight() {
		const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
		directionalLight.castShadow = true;
		directionalLight.position.set(100, 100, 100);
		directionalLight.shadow.camera.far = 200;
		directionalLight.shadow.camera.left = -50;
		directionalLight.shadow.camera.right = 50;
		directionalLight.shadow.camera.top = 50;
		directionalLight.shadow.camera.bottom = -50;
		directionalLight.shadow.mapSize.set(2048, 2048);
		return directionalLight;
	}

	private applyState(state: SkyTransitionState) {
		const sunDirection = state.sunDirection.clone().normalize();
		this.atmosphere.setSunDirection(sunDirection);

		this.directionalLight.position.copy(sunDirection).multiplyScalar(120);
		this.directionalLight.intensity = state.directionalLightIntensity;
		this.directionalLight.color.copy(state.directionalLightColor);

		this.ambientLight.intensity = state.ambientLightIntensity;
		this.ambientLight.color.copy(state.ambientLightColor);

		this.renderer.toneMappingExposure = state.exposure;

		if (this.scene.fog instanceof THREE.FogExp2) {
			this.scene.fog.color.copy(state.fogColor);
			this.scene.fog.density = state.fogDensity;
		}
	}

	private applyControls() {
		const state = this.stateFromControls();
		this.toggle.setState(state);
		this.atmosphere.setSettings(this.atmosphereSettingsFromControls());
		this.bake(true);
	}

	private stateFromControls(): SkyTransitionState {
		return {
			sunDirection: directionFromAzimuthElevation(
				this.controls.sunAzimuth,
				this.controls.sunElevation
			),
			directionalLightIntensity: this.controls.directionalLightIntensity,
			directionalLightColor: new THREE.Color(this.controls.directionalLightColor),
			ambientLightIntensity: this.controls.ambientLightIntensity,
			ambientLightColor: new THREE.Color(this.controls.ambientLightColor),
			fogDensity: this.controls.fogDensity,
			fogColor: new THREE.Color(this.controls.fogColor),
			exposure: this.controls.exposure,
		};
	}

	private atmosphereSettingsFromControls(): SkyAtmosphereSettings {
		return {
			sunIntensity: this.controls.sunIntensity,
			rayleighStrength: this.controls.rayleighStrength,
			mieStrength: this.controls.mieStrength,
			ozoneStrength: this.controls.ozoneStrength,
			horizonOffset: this.controls.horizonOffset,
			skyMultiplier: this.controls.skyMultiplier,
			daySkyStrength: this.controls.daySkyStrength,
			nightSkyStrength: this.controls.nightSkyStrength,
			twilightStrength: this.controls.twilightStrength,
			twilightAmberStrength: this.controls.twilightAmberStrength,
			twilightRoseStrength: this.controls.twilightRoseStrength,
			dayHorizonColor: this.controls.dayHorizonColor,
			dayZenithColor: this.controls.dayZenithColor,
			nightHorizonColor: this.controls.nightHorizonColor,
			nightZenithColor: this.controls.nightZenithColor,
			twilightLowColor: this.controls.twilightLowColor,
			twilightHighColor: this.controls.twilightHighColor,
			twilightAmberColor: this.controls.twilightAmberColor,
			twilightRoseColor: this.controls.twilightRoseColor,
		};
	}

	private createControlValues(state: SkyTransitionState): SkyControlValues {
		const sun = directionToAzimuthElevation(state.sunDirection);

		return {
			...DEFAULT_SKY_ATMOSPHERE_SETTINGS,
			...sun,
			exposure: state.exposure,
			directionalLightIntensity: state.directionalLightIntensity,
			directionalLightColor: colorToHex(state.directionalLightColor),
			ambientLightIntensity: state.ambientLightIntensity,
			ambientLightColor: colorToHex(state.ambientLightColor),
			fogDensity: state.fogDensity,
			fogColor: colorToHex(state.fogColor),
			toggleDayNight: () => this.toggleMode(),
			copyJSON: () => this.copyJSON(),
		};
	}

	private syncControlsFromState(state: SkyTransitionState) {
		const sun = directionToAzimuthElevation(state.sunDirection);
		this.controls.sunAzimuth = sun.sunAzimuth;
		this.controls.sunElevation = sun.sunElevation;
		this.controls.exposure = state.exposure;
		this.controls.directionalLightIntensity = state.directionalLightIntensity;
		this.controls.directionalLightColor = colorToHex(state.directionalLightColor);
		this.controls.ambientLightIntensity = state.ambientLightIntensity;
		this.controls.ambientLightColor = colorToHex(state.ambientLightColor);
		this.controls.fogDensity = state.fogDensity;
		this.controls.fogColor = colorToHex(state.fogColor);
		this.refreshGUI();
	}

	private addController(
		folder: dat.GUI,
		object: SkyControlValues,
		property: keyof SkyControlValues,
		min: number,
		max: number,
		step: number
	) {
		const controller = folder.add(object as any, property as string, min, max, step);
		this.guiControllers.push(controller);
		return controller;
	}

	private addColorController(
		folder: dat.GUI,
		object: SkyControlValues,
		property: keyof SkyControlValues
	) {
		const controller = folder.addColor(object as any, property as string);
		this.guiControllers.push(controller);
		return controller;
	}

	private refreshGUI() {
		for (const controller of this.guiControllers) {
			controller.updateDisplay();
		}
	}

	private getControlJSON() {
		const state = this.stateFromControls();
		return {
			mode: this.mode,
			sun: {
				azimuth: this.controls.sunAzimuth,
				elevation: this.controls.sunElevation,
				direction: state.sunDirection.toArray(),
			},
			atmosphere: this.atmosphereSettingsFromControls(),
			lighting: {
				exposure: this.controls.exposure,
				directionalLightIntensity: this.controls.directionalLightIntensity,
				directionalLightColor: this.controls.directionalLightColor,
				ambientLightIntensity: this.controls.ambientLightIntensity,
				ambientLightColor: this.controls.ambientLightColor,
			},
			fog: {
				density: this.controls.fogDensity,
				color: this.controls.fogColor,
			},
		};
	}

	private async copyJSON() {
		const json = JSON.stringify(this.getControlJSON(), null, 2);

		try {
			await navigator.clipboard.writeText(json);
			console.log("Sky settings copied to clipboard", json);
		} catch {
			const textArea = document.createElement("textarea");
			textArea.value = json;
			textArea.style.position = "fixed";
			textArea.style.opacity = "0";
			document.body.appendChild(textArea);
			textArea.select();
			document.execCommand("copy");
			document.body.removeChild(textArea);
			console.log("Sky settings copied to clipboard", json);
		}
	}

	private bake(updateEnvironment: boolean) {
		const previousRenderTarget = this.renderer.getRenderTarget();
		const previousXrEnabled = this.renderer.xr.enabled;
		const previousShadowAutoUpdate = this.renderer.shadowMap.autoUpdate;

		this.renderer.xr.enabled = false;
		this.renderer.shadowMap.autoUpdate = false;
		this.cubeCamera.update(this.renderer, this.skyScene);
		this.renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
		this.renderer.xr.enabled = previousXrEnabled;
		this.renderer.setRenderTarget(previousRenderTarget);

		if (!updateEnvironment) {
			return;
		}

		const nextEnvironmentTarget = this.pmremGenerator.fromCubemap(
			this.cubeTarget.texture
		);
		const previousEnvironmentTarget = this.environmentTarget;
		this.environmentTarget = nextEnvironmentTarget;
		this.scene.environment = nextEnvironmentTarget.texture;
		previousEnvironmentTarget?.dispose();
	}
}
