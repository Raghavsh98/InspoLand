import * as THREE from "three";

export interface SkyTransitionState {
	sunDirection: THREE.Vector3;
	directionalLightIntensity: number;
	directionalLightColor: THREE.Color;
	ambientLightIntensity: number;
	ambientLightColor: THREE.Color;
	fogDensity: number;
	fogColor: THREE.Color;
	exposure: number;
}

type UpdateCallback = (state: SkyTransitionState) => void;

const cloneState = (state: SkyTransitionState): SkyTransitionState => ({
	sunDirection: state.sunDirection.clone().normalize(),
	directionalLightIntensity: state.directionalLightIntensity,
	directionalLightColor: state.directionalLightColor.clone(),
	ambientLightIntensity: state.ambientLightIntensity,
	ambientLightColor: state.ambientLightColor.clone(),
	fogDensity: state.fogDensity,
	fogColor: state.fogColor.clone(),
	exposure: state.exposure,
});

const easeInOutCubic = (t: number) =>
	t < 0.5 ? 4.0 * t * t * t : 1.0 - Math.pow(-2.0 * t + 2.0, 3.0) / 2.0;

const slerpDirection = (
	from: THREE.Vector3,
	to: THREE.Vector3,
	alpha: number
) => {
	const start = from.clone().normalize();
	const end = to.clone().normalize();
	const dot = THREE.MathUtils.clamp(start.dot(end), -1, 1);

	if (dot > 0.9995) {
		return start.lerp(end, alpha).normalize();
	}

	const theta = Math.acos(dot) * alpha;
	const relative = end.sub(start.clone().multiplyScalar(dot)).normalize();

	return start
		.multiplyScalar(Math.cos(theta))
		.add(relative.multiplyScalar(Math.sin(theta)))
		.normalize();
};

const interpolateState = (
	from: SkyTransitionState,
	to: SkyTransitionState,
	alpha: number
): SkyTransitionState => ({
	sunDirection: slerpDirection(from.sunDirection, to.sunDirection, alpha),
	directionalLightIntensity: THREE.MathUtils.lerp(
		from.directionalLightIntensity,
		to.directionalLightIntensity,
		alpha
	),
	directionalLightColor: from.directionalLightColor
		.clone()
		.lerp(to.directionalLightColor, alpha),
	ambientLightIntensity: THREE.MathUtils.lerp(
		from.ambientLightIntensity,
		to.ambientLightIntensity,
		alpha
	),
	ambientLightColor: from.ambientLightColor
		.clone()
		.lerp(to.ambientLightColor, alpha),
	fogDensity: THREE.MathUtils.lerp(from.fogDensity, to.fogDensity, alpha),
	fogColor: from.fogColor.clone().lerp(to.fogColor, alpha),
	exposure: THREE.MathUtils.lerp(from.exposure, to.exposure, alpha),
});

export class SkyToggle {
	private currentState: SkyTransitionState;
	private fromState: SkyTransitionState;
	private toState: SkyTransitionState;
	private startTime = 0;
	private duration = 0;
	private active = false;
	private readonly onUpdate: UpdateCallback;
	private readonly reduceMotion: boolean;

	constructor(initialState: SkyTransitionState, onUpdate: UpdateCallback) {
		this.currentState = cloneState(initialState);
		this.fromState = cloneState(initialState);
		this.toState = cloneState(initialState);
		this.onUpdate = onUpdate;
		this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	}

	public toggle(toState: SkyTransitionState, duration = 2200) {
		this.fromState = cloneState(this.currentState);
		this.toState = cloneState(toState);
		this.duration = this.reduceMotion ? 0 : duration;
		this.startTime = performance.now();
		this.active = this.duration > 0;

		if (!this.active) {
			this.currentState = cloneState(toState);
			this.onUpdate(this.currentState);
		}
	}

	public update(now = performance.now()) {
		if (!this.active) {
			return false;
		}

		const elapsed = now - this.startTime;
		const progress = this.duration === 0 ? 1 : Math.min(elapsed / this.duration, 1);
		const easedProgress = easeInOutCubic(progress);
		this.currentState = interpolateState(this.fromState, this.toState, easedProgress);
		this.onUpdate(this.currentState);

		if (progress >= 1) {
			this.active = false;
			this.currentState = cloneState(this.toState);
			this.onUpdate(this.currentState);
		}

		return true;
	}

	public getState() {
		return cloneState(this.currentState);
	}

	public setState(state: SkyTransitionState) {
		this.active = false;
		this.currentState = cloneState(state);
		this.fromState = cloneState(state);
		this.toState = cloneState(state);
		this.onUpdate(this.currentState);
	}

	public isActive() {
		return this.active;
	}
}
