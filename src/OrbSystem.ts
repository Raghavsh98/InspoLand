import * as THREE from "three";

interface OrbData {
    mesh: THREE.Mesh;
    light: THREE.PointLight;
    material: THREE.MeshBasicMaterial;
    startTime: number;
    duration: number;
    basePosition: THREE.Vector3;
    targetHeight: number;
    phase: 'rising' | 'paused' | 'falling';
    phaseStartTime: number;
    isHovered: boolean;
    targetOpacity: number;
    currentOpacity: number;
}

export class OrbSystem {
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private terrainMesh: THREE.Mesh;
    private orbs: OrbData[] = [];
    private lastSpawnTime: number = 0;
    private spawnInterval: number = 5000; // 5 seconds in milliseconds
    private maxOrbs: number = 2;
    private orbMaterial: THREE.MeshBasicMaterial;
    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();
    private canvas: HTMLCanvasElement;
    
    // Handpicked spawn locations
    private spawnPoints: THREE.Vector3[] = [
        new THREE.Vector3(8.30, 1.11, -8.60),
        new THREE.Vector3(17.42, 2.70, -1.47),
        new THREE.Vector3(11.64, 1.05, -12.90),
        new THREE.Vector3(11.03, 4.54, 9.40),
        new THREE.Vector3(6.71, 4.32, 5.33),
        new THREE.Vector3(2.33, 3.19, -14.05),
        new THREE.Vector3(17.32, 3.36, 2.43),
        new THREE.Vector3(7.93, 1.75, -13.34)
    ];

    constructor(scene: THREE.Scene, camera: THREE.Camera, terrainMesh: THREE.Mesh, canvas: HTMLCanvasElement) {
        this.scene = scene;
        this.camera = camera;
        this.terrainMesh = terrainMesh;
        this.canvas = canvas;
        
        // Create orb material template - off-white, emissive, 80% opacity
        this.orbMaterial = new THREE.MeshBasicMaterial({
            color: 0xf5f5f0, // Off-white color
            emissive: 0xf5f5f0,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.8
        });

        // Set up mouse tracking for hover effects
        this.setupMouseTracking();
    }

    public update(currentTime: number): void {
        // Spawn new orbs if needed
        if (currentTime - this.lastSpawnTime >= this.spawnInterval) {
            this.spawnOrbs(currentTime);
            this.lastSpawnTime = currentTime;
        }

        // Update hover detection
        this.updateHoverDetection();

        // Update existing orbs
        for (let i = this.orbs.length - 1; i >= 0; i--) {
            const orb = this.orbs[i];
            const orbAge = currentTime - orb.startTime;
            
            if (orbAge >= orb.duration) {
                // Remove expired orb
                this.removeOrb(i);
                continue;
            }

            this.updateOrbAnimation(orb, currentTime);
            this.updateOrbSize(orb);
            this.updateOrbOpacity(orb);
        }
    }

    private spawnOrbs(currentTime: number): void {
        // Only spawn if we have less than max orbs
        const orbsToSpawn = Math.min(2, this.maxOrbs - this.orbs.length);
        
        for (let i = 0; i < orbsToSpawn; i++) {
            this.createOrb(currentTime);
        }
    }

    private createOrb(currentTime: number): void {
        // Pick a random spawn point from the predefined locations
        const randomIndex = Math.floor(Math.random() * this.spawnPoints.length);
        const position = this.spawnPoints[randomIndex].clone();

        // Create individual material for this orb (to avoid shared material issues)
        const material = this.orbMaterial.clone();

        // Create orb geometry and mesh with higher quality (32x32 segments for smoother spheres)
        const geometry = new THREE.SphereGeometry(1, 32, 32);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);

        // Create point light for glow effect - extremely high intensity to penetrate custom grass shader
        const light = new THREE.PointLight(0xf5f5f0, 50, 15); // Extremely high intensity and large radius
        light.position.copy(position);

        // Add to scene
        this.scene.add(mesh);
        this.scene.add(light);

        // Store orb data
        const orbData: OrbData = {
            mesh,
            light,
            material,
            startTime: currentTime,
            duration: 3100, // 3.1 seconds total (100ms more)
            basePosition: position.clone(),
            targetHeight: 1.0, // Rise 1 unit
            phase: 'rising',
            phaseStartTime: currentTime,
            isHovered: false,
            targetOpacity: 0.8,
            currentOpacity: 0.8
        };

        this.orbs.push(orbData);
    }

    private updateOrbAnimation(orb: OrbData, currentTime: number): void {
        const phaseAge = currentTime - orb.phaseStartTime;
        
        switch (orb.phase) {
            case 'rising':
                // Rising phase: 0.5 seconds with ease-out
                const risingDuration = 500; // 0.5 seconds
                if (phaseAge >= risingDuration) {
                    orb.phase = 'paused';
                    orb.phaseStartTime = currentTime;
                    // Set to peak position
                    const peakY = orb.basePosition.y + orb.targetHeight;
                    orb.mesh.position.y = peakY;
                    orb.light.position.y = peakY;
                } else {
                    // Ease-out animation
                    const progress = phaseAge / risingDuration;
                    const easedProgress = 1 - Math.pow(1 - progress, 3); // Cubic ease-out
                    const currentHeight = orb.basePosition.y + (orb.targetHeight * easedProgress);
                    orb.mesh.position.y = currentHeight;
                    orb.light.position.y = currentHeight;
                }
                break;
                
            case 'paused':
                // Pause phase: 2 seconds at peak
                const pauseDuration = 2000; // 2 seconds
                if (phaseAge >= pauseDuration) {
                    orb.phase = 'falling';
                    orb.phaseStartTime = currentTime;
                }
                break;
                
            case 'falling':
                // Falling phase: 0.5 seconds with ease-in, going 0.5 units below ground
                const fallingDuration = 500; // 0.5 seconds
                const fallProgress = Math.min(phaseAge / fallingDuration, 1);
                const easedFallProgress = fallProgress * fallProgress * fallProgress; // Cubic ease-in
                
                // Calculate target depth (0.5 units below ground level)
                const groundLevel = orb.basePosition.y;
                const targetDepth = groundLevel - 0.5;
                const totalFallDistance = orb.targetHeight + 0.5; // From peak to 0.5 units below ground
                
                const currentHeight = orb.basePosition.y + orb.targetHeight - (totalFallDistance * easedFallProgress);
                orb.mesh.position.y = currentHeight;
                orb.light.position.y = currentHeight;
                
                // Keep full opacity and light intensity throughout falling
                // Orb will be removed completely when duration expires
                break;
        }
    }

    private updateOrbSize(orb: OrbData): void {
        // Calculate distance from camera
        const distance = orb.mesh.position.distanceTo(this.camera.position);
        
        // Scale based on distance (closer = larger)
        // Base size reduced to 80% (1.6 instead of 2.0)
        const baseSize = 1.6;
        const scaleFactor = Math.max(0.3, baseSize / (distance * 0.1));
        
        orb.mesh.scale.setScalar(scaleFactor);
    }

    private setupMouseTracking(): void {
        this.canvas.addEventListener('mousemove', (event) => {
            // Update mouse position
            this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        });
    }

    private updateHoverDetection(): void {
        // Update raycaster
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Get all orb meshes
        const orbMeshes = this.orbs.map(orb => orb.mesh);
        
        // Check for intersections
        const intersects = this.raycaster.intersectObjects(orbMeshes);
        
        // Reset all hover states
        this.orbs.forEach(orb => {
            orb.isHovered = false;
            orb.targetOpacity = 0.8; // Default opacity
        });
        
        // Set hovered state for intersected orbs
        if (intersects.length > 0) {
            const hoveredMesh = intersects[0].object;
            const hoveredOrb = this.orbs.find(orb => orb.mesh === hoveredMesh);
            if (hoveredOrb) {
                hoveredOrb.isHovered = true;
                hoveredOrb.targetOpacity = 1.0; // Full opacity on hover
            }
        }
    }

    private updateOrbOpacity(orb: OrbData): void {
        // Smooth opacity transition with ease-out curve
        const opacityDiff = orb.targetOpacity - orb.currentOpacity;
        const easeSpeed = 0.1; // Adjust for faster/slower transitions
        
        // Ease-out calculation
        orb.currentOpacity += opacityDiff * easeSpeed;
        
        // Apply opacity to material
        orb.material.opacity = orb.currentOpacity;
    }



    private removeOrb(index: number): void {
        const orb = this.orbs[index];
        this.scene.remove(orb.mesh);
        this.scene.remove(orb.light);
        orb.mesh.geometry.dispose();
        this.orbs.splice(index, 1);
    }

    public getSimpleOrbData(): { positions: THREE.Vector3[], intensities: number[] } {
        const positions: THREE.Vector3[] = [];
        const intensities: number[] = [];
        
        for (const orb of this.orbs) {
            positions.push(orb.mesh.position.clone());
            
            // Calculate eased intensity based on orb lifecycle
            const currentTime = Date.now();
            const orbAge = currentTime - orb.startTime;
            let easedIntensity = orb.light.intensity;
            
            if (orb.phase === 'rising') {
                // Fade in during rising phase (0.5 seconds)
                const risingProgress = Math.min(orbAge / 500, 1); // 500ms rising phase
                const easeOut = 1 - Math.pow(1 - risingProgress, 3); // Cubic ease-out
                easedIntensity = orb.light.intensity * easeOut;
            } else if (orb.phase === 'falling') {
                // Fade out during falling phase (0.5 seconds)
                const fallingAge = currentTime - orb.phaseStartTime;
                const fallingProgress = Math.min(fallingAge / 500, 1); // 500ms falling phase
                const easeOut = 1 - Math.pow(fallingProgress, 3); // Cubic ease-out (inverted for fade out)
                easedIntensity = orb.light.intensity * easeOut;
            }
            // During 'paused' phase, use full intensity
            
            intensities.push(easedIntensity);
        }
        
        return { positions, intensities };
    }

    public dispose(): void {
        // Clean up all orbs
        for (let i = this.orbs.length - 1; i >= 0; i--) {
            this.removeOrb(i);
        }
    }
}