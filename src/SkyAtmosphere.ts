import * as THREE from "three";

export interface SkyAtmosphereSettings {
	sunIntensity: number;
	rayleighStrength: number;
	mieStrength: number;
	ozoneStrength: number;
	horizonOffset: number;
	skyMultiplier: number;
	daySkyStrength: number;
	nightSkyStrength: number;
	twilightStrength: number;
	twilightAmberStrength: number;
	twilightRoseStrength: number;
	dayHorizonColor: string;
	dayZenithColor: string;
	nightHorizonColor: string;
	nightZenithColor: string;
	twilightLowColor: string;
	twilightHighColor: string;
	twilightAmberColor: string;
	twilightRoseColor: string;
}

export const DEFAULT_SKY_ATMOSPHERE_SETTINGS: SkyAtmosphereSettings = {
	sunIntensity: 34,
	rayleighStrength: 5.7,
	mieStrength: 17.1,
	ozoneStrength: 10,
	horizonOffset: 0.188,
	skyMultiplier: 0,
	daySkyStrength: 1.5,
	nightSkyStrength: 1.17,
	twilightStrength: 1.32,
	twilightAmberStrength: 0.49,
	twilightRoseStrength: 1.26,
	dayHorizonColor: "#becdff",
	dayZenithColor: "#6092dd",
	nightHorizonColor: "#000023",
	nightZenithColor: "#03102d",
	twilightLowColor: "#29292b",
	twilightHighColor: "#272772",
	twilightAmberColor: "#ed681d",
	twilightRoseColor: "#0c0209",
};

const ATMOSPHERE_VERTEX_SHADER = `
varying vec3 vWorldDirection;

void main() {
	vec4 worldPosition = modelMatrix * vec4(position, 1.0);
	vWorldDirection = normalize(position);
	gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const ATMOSPHERE_FRAGMENT_SHADER = `
precision highp float;

uniform vec3 uSunDirection;
uniform float uSunIntensity;
uniform float uRayleighStrength;
uniform float uMieStrength;
uniform float uOzoneStrength;
uniform float uHorizonOffset;
uniform float uSkyMultiplier;
uniform float uDaySkyStrength;
uniform float uNightSkyStrength;
uniform float uTwilightStrength;
uniform float uTwilightAmberStrength;
uniform float uTwilightRoseStrength;
uniform vec3 uDayHorizonColor;
uniform vec3 uDayZenithColor;
uniform vec3 uNightHorizonColor;
uniform vec3 uNightZenithColor;
uniform vec3 uTwilightLowColor;
uniform vec3 uTwilightHighColor;
uniform vec3 uTwilightAmberColor;
uniform vec3 uTwilightRoseColor;

varying vec3 vWorldDirection;

const float PI = 3.14159265359;
const float PLANET_RADIUS = 6360.0;
const float ATMOSPHERE_RADIUS = 6460.0;
const float RAYLEIGH_SCALE_HEIGHT = 8.0;
const float MIE_SCALE_HEIGHT = 1.2;
const int VIEW_STEPS = 12;
const int LIGHT_STEPS = 4;

const vec3 BETA_RAYLEIGH = vec3(5.802, 13.558, 33.100) * 1e-6;
const vec3 BETA_MIE = vec3(3.996, 3.996, 3.996) * 1e-6;
const vec3 BETA_OZONE = vec3(0.650, 1.881, 0.085) * 1e-6;

vec2 raySphere(vec3 origin, vec3 direction, float radius) {
	float b = dot(origin, direction);
	float c = dot(origin, origin) - radius * radius;
	float h = b * b - c;

	if (h < 0.0) {
		return vec2(1e5, -1e5);
	}

	h = sqrt(h);
	return vec2(-b - h, -b + h);
}

float rayleighDensity(float height) {
	return exp(-height / RAYLEIGH_SCALE_HEIGHT);
}

float mieDensity(float height) {
	return exp(-height / MIE_SCALE_HEIGHT);
}

float ozoneDensity(float height) {
	float center = 25.0;
	float width = 15.0;
	return max(0.0, 1.0 - abs(height - center) / width);
}

vec3 opticalDepth(vec3 origin, vec3 direction, float rayLength) {
	float stepSize = rayLength / float(LIGHT_STEPS);
	vec3 depth = vec3(0.0);

	for (int i = 0; i < LIGHT_STEPS; i++) {
		float t = (float(i) + 0.5) * stepSize;
		vec3 position = origin + direction * t;
		float height = max(0.0, length(position) - PLANET_RADIUS);

		depth.x += rayleighDensity(height) * stepSize;
		depth.y += mieDensity(height) * stepSize;
		depth.z += ozoneDensity(height) * stepSize;
	}

	return depth;
}

float rayleighPhase(float cosTheta) {
	return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

float miePhase(float cosTheta, float g) {
	float g2 = g * g;
	float denom = pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
	return (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + cosTheta * cosTheta)) / ((2.0 + g2) * denom);
}

vec3 getSkyColor(vec3 viewDir, vec3 sunDir) {
	vec3 cameraPosition = vec3(0.0, PLANET_RADIUS + 0.04, 0.0);

	vec2 atmosphereHit = raySphere(cameraPosition, viewDir, ATMOSPHERE_RADIUS);
	if (atmosphereHit.y < 0.0) {
		return vec3(0.0);
	}

	float rayStart = max(atmosphereHit.x, 0.0);
	float rayEnd = atmosphereHit.y;

	float rayLength = max(0.0, rayEnd - rayStart);
	float stepSize = rayLength / float(VIEW_STEPS);

	vec3 accumulatedRayleigh = vec3(0.0);
	vec3 accumulatedMie = vec3(0.0);
	vec3 viewDepth = vec3(0.0);

	for (int i = 0; i < VIEW_STEPS; i++) {
		float t = rayStart + (float(i) + 0.5) * stepSize;
		vec3 position = cameraPosition + viewDir * t;
		float height = max(0.0, length(position) - PLANET_RADIUS);

		float localRayleigh = rayleighDensity(height) * stepSize;
		float localMie = mieDensity(height) * stepSize;
		float localOzone = ozoneDensity(height) * stepSize;

		viewDepth += vec3(localRayleigh, localMie, localOzone);

		vec2 sunHit = raySphere(position, sunDir, ATMOSPHERE_RADIUS);
		vec3 lightDepth = opticalDepth(position, sunDir, max(0.0, sunHit.y));

		vec3 extinction =
			BETA_RAYLEIGH * uRayleighStrength * (viewDepth.x + lightDepth.x) +
			BETA_MIE * uMieStrength * (viewDepth.y + lightDepth.y) +
			BETA_OZONE * uOzoneStrength * (viewDepth.z + lightDepth.z);

		vec3 transmittance = exp(-extinction);
		accumulatedRayleigh += localRayleigh * transmittance;
		accumulatedMie += localMie * transmittance;
	}

	float mu = dot(viewDir, sunDir);
	vec3 rayleigh = accumulatedRayleigh * BETA_RAYLEIGH * uRayleighStrength * rayleighPhase(mu);
	vec3 mie = accumulatedMie * BETA_MIE * uMieStrength * miePhase(mu, 0.76);

	vec3 color = (rayleigh + mie) * uSunIntensity;

	float sunDisk = smoothstep(0.99955, 0.9999, mu) * smoothstep(-0.02, 0.06, sunDir.y);
	color += vec3(1.0, 0.82, 0.55) * sunDisk * 24.0;

	return color;
}

void main() {
	vec3 viewDir = normalize(vWorldDirection);
	vec3 sunDir = normalize(uSunDirection);
	vec3 color = getSkyColor(viewDir, sunDir);

	float shiftedY = clamp(viewDir.y + uHorizonOffset, -1.0, 1.0);
	float up = smoothstep(-0.05, 0.9, shiftedY);
	float horizon = pow(max(0.0, 1.0 - abs(shiftedY)), 2.2);
	float dayAmount = smoothstep(-0.04, 0.22, sunDir.y);
	float twilightAmount = smoothstep(-0.30, -0.04, sunDir.y) * (1.0 - smoothstep(0.12, 0.32, sunDir.y));
	float nightAmount = 1.0 - smoothstep(-0.22, 0.06, sunDir.y);

	vec3 daySky = mix(uDayHorizonColor, uDayZenithColor, up) * dayAmount * uDaySkyStrength;

	vec3 nightSky = mix(uNightHorizonColor, uNightZenithColor, up) * nightAmount * uNightSkyStrength;

	vec3 flatView = normalize(vec3(viewDir.x, 0.0, viewDir.z) + vec3(0.0001));
	vec3 flatSun = normalize(vec3(sunDir.x, 0.0, sunDir.z) + vec3(0.0001));
	float sunAzimuth = pow(max(dot(flatView, flatSun), 0.0), 3.0);
	vec3 twilightIndigo = mix(uTwilightLowColor, uTwilightHighColor, up);
	vec3 twilightAmber = uTwilightAmberColor * horizon * sunAzimuth * uTwilightAmberStrength;
	vec3 twilightRose = uTwilightRoseColor * horizon * (1.0 - sunAzimuth) * uTwilightRoseStrength;
	vec3 twilightSky = (twilightIndigo + twilightAmber + twilightRose) * twilightAmount * uTwilightStrength;

	// The raymarch gives the physical base; this layer pushes it toward the richer
	// blue-hour palette in the references without introducing a separate night model.
	color = color * uSkyMultiplier + daySky + twilightSky + nightSky;

	gl_FragColor = vec4(color, 1.0);
}
`;

export class SkyAtmosphere {
	public readonly mesh: THREE.Mesh;
	public readonly backgroundMesh: THREE.Mesh;
	public readonly material: THREE.ShaderMaterial;
	private readonly geometry: THREE.SphereGeometry;
	private settings: SkyAtmosphereSettings = { ...DEFAULT_SKY_ATMOSPHERE_SETTINGS };

	constructor() {
		this.material = new THREE.ShaderMaterial({
			vertexShader: ATMOSPHERE_VERTEX_SHADER,
			fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
			depthWrite: false,
			depthTest: false,
			side: THREE.BackSide,
			uniforms: {
				uSunDirection: { value: new THREE.Vector3(1, 0.6, 0.3).normalize() },
				uSunIntensity: { value: this.settings.sunIntensity },
				uRayleighStrength: { value: this.settings.rayleighStrength },
				uMieStrength: { value: this.settings.mieStrength },
				uOzoneStrength: { value: this.settings.ozoneStrength },
				uHorizonOffset: { value: this.settings.horizonOffset },
				uSkyMultiplier: { value: this.settings.skyMultiplier },
				uDaySkyStrength: { value: this.settings.daySkyStrength },
				uNightSkyStrength: { value: this.settings.nightSkyStrength },
				uTwilightStrength: { value: this.settings.twilightStrength },
				uTwilightAmberStrength: { value: this.settings.twilightAmberStrength },
				uTwilightRoseStrength: { value: this.settings.twilightRoseStrength },
				uDayHorizonColor: { value: new THREE.Color(this.settings.dayHorizonColor) },
				uDayZenithColor: { value: new THREE.Color(this.settings.dayZenithColor) },
				uNightHorizonColor: { value: new THREE.Color(this.settings.nightHorizonColor) },
				uNightZenithColor: { value: new THREE.Color(this.settings.nightZenithColor) },
				uTwilightLowColor: { value: new THREE.Color(this.settings.twilightLowColor) },
				uTwilightHighColor: { value: new THREE.Color(this.settings.twilightHighColor) },
				uTwilightAmberColor: { value: new THREE.Color(this.settings.twilightAmberColor) },
				uTwilightRoseColor: { value: new THREE.Color(this.settings.twilightRoseColor) },
			},
		});

		this.geometry = new THREE.SphereGeometry(5, 64, 32);
		this.mesh = new THREE.Mesh(this.geometry, this.material);
		this.mesh.renderOrder = 0;

		this.backgroundMesh = new THREE.Mesh(this.geometry, this.material);
		this.backgroundMesh.frustumCulled = false;
		this.backgroundMesh.renderOrder = -1000;
		this.backgroundMesh.scale.setScalar(100);
	}

	public setSunDirection(sunDirection: THREE.Vector3) {
		this.material.uniforms.uSunDirection.value.copy(sunDirection).normalize();
	}

	public setSettings(settings: Partial<SkyAtmosphereSettings>) {
		this.settings = { ...this.settings, ...settings };
		this.material.uniforms.uSunIntensity.value = this.settings.sunIntensity;
		this.material.uniforms.uRayleighStrength.value = this.settings.rayleighStrength;
		this.material.uniforms.uMieStrength.value = this.settings.mieStrength;
		this.material.uniforms.uOzoneStrength.value = this.settings.ozoneStrength;
		this.material.uniforms.uHorizonOffset.value = this.settings.horizonOffset;
		this.material.uniforms.uSkyMultiplier.value = this.settings.skyMultiplier;
		this.material.uniforms.uDaySkyStrength.value = this.settings.daySkyStrength;
		this.material.uniforms.uNightSkyStrength.value = this.settings.nightSkyStrength;
		this.material.uniforms.uTwilightStrength.value = this.settings.twilightStrength;
		this.material.uniforms.uTwilightAmberStrength.value = this.settings.twilightAmberStrength;
		this.material.uniforms.uTwilightRoseStrength.value = this.settings.twilightRoseStrength;
		this.material.uniforms.uDayHorizonColor.value.set(this.settings.dayHorizonColor);
		this.material.uniforms.uDayZenithColor.value.set(this.settings.dayZenithColor);
		this.material.uniforms.uNightHorizonColor.value.set(this.settings.nightHorizonColor);
		this.material.uniforms.uNightZenithColor.value.set(this.settings.nightZenithColor);
		this.material.uniforms.uTwilightLowColor.value.set(this.settings.twilightLowColor);
		this.material.uniforms.uTwilightHighColor.value.set(this.settings.twilightHighColor);
		this.material.uniforms.uTwilightAmberColor.value.set(this.settings.twilightAmberColor);
		this.material.uniforms.uTwilightRoseColor.value.set(this.settings.twilightRoseColor);
	}

	public getSettings() {
		return { ...this.settings };
	}

	public dispose() {
		this.geometry.dispose();
		this.material.dispose();
	}
}
