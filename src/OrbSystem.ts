import * as THREE from "three";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";

interface OrbData {
    mesh: THREE.Mesh;
    light: THREE.PointLight;
    startTime: number;
    duration: number;
    basePosition: THREE.Vector3;
    targetHeight: number;
    phase: 'rising' | 'paused' | 'falling';
    phaseStartTime: number;
}

export class OrbSystem {
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private terrainMesh: THREE.Mesh;
    private sampler: MeshSurfaceSampler;
    private orbs: OrbData[] = [];
    private lastSpawnTime: number = 0;
    private spawnInterval: number = 5000; // 5 seconds in milliseconds
    private maxOrbs: number = 2;
    private orbMaterial: THREE.MeshBasicMaterial;

    constructor(scene: THREE.Scene, camera: THREE.Camera, terrainMesh: THREE.Mesh) {
        this.scene = scene;
        this.camera = camera;
        this.terrainMesh = terrainMesh;
        
        // Create sampler for terrain surface
        this.sampler = new MeshSurfaceSampler(terrainMesh).build();
        
        // Create orb material - off-white, emissive, semi-transparent
        this.orbMaterial = new THREE.MeshBasicMaterial({
            color: 0xf5f5f0, // Off-white color
            emissive: 0xf5f5f0,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.8
        });
    }

    public update(currentTime: number): void {
        // Spawn new orbs if needed
        if (currentTime - this.lastSpawnTime >= this.spawnInterval) {
            this.spawnOrbs(currentTime);
            this.lastSpawnTime = currentTime;
        }

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
        // Sample random position on terrain surface
        const position = new THREE.Vector3();
        const normal = new THREE.Vector3();
        this.sampler.sample(position, normal);

        // Check if position is visible from camera (basic frustum check)
        if (!this.isPositionVisible(position)) {
            return; // Skip this orb if not visible
        }

        // Create orb geometry and mesh
        const geometry = new THREE.SphereGeometry(1, 16, 16);
        const mesh = new THREE.Mesh(geometry, this.orbMaterial);
        mesh.position.copy(position);

        // Create point light for glow effect - off-white light
        const light = new THREE.PointLight(0xf5f5f0, 2, 5); // Off-white light, intensity 2, distance 5
        light.position.copy(position);

        // Add to scene
        this.scene.add(mesh);
        this.scene.add(light);

        // Store orb data
        const orbData: OrbData = {
            mesh,
            light,
            startTime: currentTime,
            duration: 3000, // 3 seconds total
            basePosition: position.clone(),
            targetHeight: 1.0, // Rise 1 unit
            phase: 'rising',
            phaseStartTime: currentTime
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
                // Falling phase: 0.5 seconds with ease-in
                const fallingDuration = 500; // 0.5 seconds
                const fallProgress = Math.min(phaseAge / fallingDuration, 1);
                const easedFallProgress = fallProgress * fallProgress * fallProgress; // Cubic ease-in
                const currentHeight = orb.basePosition.y + orb.targetHeight - (orb.targetHeight * easedFallProgress);
                orb.mesh.position.y = currentHeight;
                orb.light.position.y = currentHeight;
                
                // Also fade out during falling
                const opacity = 0.8 * (1 - easedFallProgress);
                (orb.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
                orb.light.intensity = 2 * (1 - easedFallProgress);
                break;
        }
    }

    private updateOrbSize(orb: OrbData): void {
        // Calculate distance from camera
        const distance = orb.mesh.position.distanceTo(this.camera.position);
        
        // Scale based on distance (closer = larger)
        // Base size of 2.0, scale inversely with distance
        const baseSize = 2.0;
        const scaleFactor = Math.max(0.3, baseSize / (distance * 0.1));
        
        orb.mesh.scale.setScalar(scaleFactor);
    }

    private isPositionVisible(position: THREE.Vector3): boolean {
        // Simple frustum culling - check if position is roughly in view
        // This is a basic implementation, could be improved with proper frustum checking
        const cameraPosition = this.camera.position;
        const distance = position.distanceTo(cameraPosition);
        
        // Only spawn orbs within reasonable distance (visible range)
        return distance < 50 && distance > 5;
    }

    private removeOrb(index: number): void {
        const orb = this.orbs[index];
        this.scene.remove(orb.mesh);
        this.scene.remove(orb.light);
        orb.mesh.geometry.dispose();
        this.orbs.splice(index, 1);
    }

    public dispose(): void {
        // Clean up all orbs
        for (let i = this.orbs.length - 1; i >= 0; i--) {
            this.removeOrb(i);
        }
    }
}