import * as THREE from "three";
import Stats from "stats-gl";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as dat from "dat.gui";

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import { GrassMaterial } from "./GrassMaterial";
import { OrbSystem } from "./OrbSystem";

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
	private raycaster = new THREE.Raycaster();
	private mouse = new THREE.Vector2();

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

		this.scene.background = new THREE.Color(this.sceneProps.fogColor);
		this.scene.fog = new THREE.FogExp2(
			this.sceneProps.fogColor,
			this.sceneProps.fogDensity
		);

		this.renderer = new THREE.WebGLRenderer({
			canvas: this.canvas,
			antialias: true,
			alpha: true,
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
		this.setupGUI();
		this.setupStats();
		this.setupTextures();
		// this.createCube();
		this.loadModels();
		this.setupEventListeners();
		this.addLights();
	}

	private createCube() {
		const geometry = new THREE.BoxGeometry(2, 7, 2);
		const material = new THREE.MeshPhongMaterial({ color: 0x333333 });
		const cube = new THREE.Mesh(geometry, material);
		cube.position.set(6, 5, -3);
		cube.castShadow = true;
		this.scene.add(cube);
	}

	private addLights() {
		const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
		this.scene.add(ambientLight);

		const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
		directionalLight.castShadow = true;
		directionalLight.position.set(100, 100, 100);
		directionalLight.shadow.camera.far = 200;
		directionalLight.shadow.camera.left = -50;
		directionalLight.shadow.camera.right = 50;
		directionalLight.shadow.camera.top = 50;
		directionalLight.shadow.camera.bottom = -50;
		directionalLight.shadow.mapSize.set(2048, 2048);

		this.scene.add(directionalLight);
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
		this.gltfLoader.load("/island.glb", (gltf) => {
			let terrainMesh: THREE.Mesh;
			gltf.scene.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					child.material = this.terrainMat;
					child.receiveShadow = true;
					child.geometry.scale(3, 3, 3);
					terrainMesh = child;
				}
			});
			this.scene.add(gltf.scene);

			// load grass model
			this.gltfLoader.load("/grassLODs.glb", (gltf) => {
				gltf.scene.traverse((child) => {
					if (child instanceof THREE.Mesh) {
						if (child.name.includes("LOD00")) {
							child.geometry.scale(5, 5, 5);
							this.grassGeometry = child.geometry;
						}
					}
				});

				this.addGrass(terrainMesh, this.grassGeometry);
				
				// Initialize orb system after terrain is loaded
				this.orbSystem = new OrbSystem(this.scene, this.camera, terrainMesh, this.canvas);
			});
		});


	}

	public render() {
		this.Uniforms.uTime.value += this.clock.getDelta();
		this.grassMaterial.update(this.Uniforms.uTime.value);
		
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
		this.gui.close();
		const guiContainer = this.gui.domElement.parentElement as HTMLDivElement;
		guiContainer.style.zIndex = "9999";
		guiContainer.style.position = "fixed";
		guiContainer.style.top = "0";
		guiContainer.style.left = "0";
		guiContainer.style.right = "auto";
		guiContainer.style.display = "none"; // Hide the controls

		this.sceneGUI = this.gui.addFolder("Scene Properties");
		this.sceneGUI.add(this.orbitControls, "autoRotate").name("Auto Rotate");
		this.sceneGUI
			.add(this.sceneProps, "fogDensity", 0, 0.05, 0.000001)
			.onChange((value) => {
				(this.scene.fog as THREE.FogExp2).density = value;
			});
		this.sceneGUI.addColor(this.sceneProps, "fogColor").onChange((value) => {
			this.scene.fog?.color.set(value);
			this.scene.background = new THREE.Color(value);
		});

		this.grassMaterial.setupGUI(this.sceneGUI);

		this.sceneGUI.open();
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

		// Commented out due to TypeScript errors with private dom property
		// this.stats.dom.addEventListener("click", () => {
		// 	console.log(this.renderer.info.render);
		// });

		// Mouse tracking for coordinate picking
		this.canvas.addEventListener("mousemove", (event) => this.onMouseMove(event), false);
		this.canvas.addEventListener("click", (event) => this.onMouseClick(event), false);

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

	private onMouseMove(event: MouseEvent) {
		// Calculate mouse position in normalized device coordinates
		this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
		this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
		
		// Update the picking ray with the camera and mouse position
		this.raycaster.setFromCamera(this.mouse, this.camera);
		
		// Calculate objects intersecting the picking ray
		const intersects = this.raycaster.intersectObjects(this.scene.children, true);
		
		if (intersects.length > 0) {
			const intersect = intersects[0];
			const point = intersect.point;
			
			// Update mouse coordinate display
			const mouseX = document.getElementById('mouse-x');
			const mouseY = document.getElementById('mouse-y');
			const mouseZ = document.getElementById('mouse-z');
			
			if (mouseX && mouseY && mouseZ) {
				mouseX.textContent = point.x.toFixed(2);
				mouseY.textContent = point.y.toFixed(2);
				mouseZ.textContent = point.z.toFixed(2);
			}
		}
	}

	private onMouseClick(event: MouseEvent) {
		// Calculate mouse position in normalized device coordinates
		this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
		this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
		
		// Update the picking ray with the camera and mouse position
		this.raycaster.setFromCamera(this.mouse, this.camera);
		
		// Calculate objects intersecting the picking ray
		const intersects = this.raycaster.intersectObjects(this.scene.children, true);
		
		if (intersects.length > 0) {
			const intersect = intersects[0];
			const point = intersect.point;
			
			// Copy coordinates to clipboard
			const coordinates = `new THREE.Vector3(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`;
			navigator.clipboard.writeText(coordinates).then(() => {
				console.log('Coordinates copied to clipboard:', coordinates);
				
				// Visual feedback
				const mousePanel = document.querySelector('.mouse-panel') as HTMLElement;
				if (mousePanel) {
					const originalBg = mousePanel.style.backgroundColor;
					mousePanel.style.backgroundColor = 'rgba(0, 255, 0, 0.3)';
					setTimeout(() => {
						mousePanel.style.backgroundColor = originalBg;
					}, 200);
				}
			}).catch(() => {
				console.log('Coordinates (copy manually):', coordinates);
			});
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
