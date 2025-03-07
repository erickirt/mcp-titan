import * as tf from '@tensorflow/tfjs-node';
import * as crypto from 'crypto';

export class MemoryManager {
    private static instance: MemoryManager;
    private cleanupInterval: NodeJS.Timeout | null = null;
    private encryptionKey: Buffer;
    private iv: Buffer;

    private constructor() {
        this.encryptionKey = crypto.randomBytes(32);
        this.iv = crypto.randomBytes(16);
        this.startPeriodicCleanup();
    }

    public static getInstance(): MemoryManager {
        if (!MemoryManager.instance) {
            MemoryManager.instance = new MemoryManager();
        }
        return MemoryManager.instance;
    }

    private startPeriodicCleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.cleanupInterval = setInterval(() => {
            tf.engine().startScope();
            try {
                // Force garbage collection of unused tensors
                tf.engine().disposeVariables();
                // Clean up tensors
                const numTensors = tf.memory().numTensors;
                if (numTensors > 1000) {
                    const tensors = tf.engine().state.numTensors;
                    tf.disposeVariables();
                    tf.dispose();
                }
            } finally {
                tf.engine().endScope();
            }
        }, 60000); // Run every minute
    }

    public validateVectorShape(tensor: tf.Tensor, expectedShape: number[]): boolean {
        return tf.tidy(() => {
            if (tensor.shape.length !== expectedShape.length) return false;
            return tensor.shape.every((dim, i) => expectedShape[i] === -1 || dim === expectedShape[i]);
        });
    }

    public encryptTensor(tensor: tf.Tensor): Buffer {
        const data = tensor.dataSync();
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, this.iv);
        const encrypted = Buffer.concat([
            cipher.update(Buffer.from(new Float32Array(data).buffer)),
            cipher.final()
        ]);
        const authTag = cipher.getAuthTag();
        return Buffer.concat([encrypted, authTag]);
    }

    public decryptTensor(encrypted: Buffer, shape: number[]): tf.Tensor {
        const authTag = encrypted.slice(-16);
        const encryptedData = encrypted.slice(0, -16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, this.iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([
            decipher.update(encryptedData),
            decipher.final()
        ]);
        const data = new Float32Array(decrypted.buffer);
        return tf.tensor(Array.from(data), shape);
    }

    public wrapWithMemoryManagement<T extends tf.TensorContainer>(fn: () => T): T {
        return tf.tidy(fn);
    }

    public async wrapWithMemoryManagementAsync<T>(fn: () => Promise<T>): Promise<T> {
        tf.engine().startScope();
        try {
            return await fn();
        } finally {
            tf.engine().endScope();
        }
    }

    public dispose(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

export class VectorProcessor {
    private static instance: VectorProcessor;
    private memoryManager: MemoryManager;

    private constructor() {
        this.memoryManager = MemoryManager.getInstance();
    }

    public static getInstance(): VectorProcessor {
        if (!VectorProcessor.instance) {
            VectorProcessor.instance = new VectorProcessor();
        }
        return VectorProcessor.instance;
    }

    public processInput(input: number | number[] | string | tf.Tensor): tf.Tensor {
        return this.memoryManager.wrapWithMemoryManagement(() => {
            if (typeof input === 'string') {
                // Convert string to vector using simple encoding
                const encoded = new TextEncoder().encode(input);
                return tf.tensor1d(Array.from(encoded));
            } else if (typeof input === 'number') {
                // Handle single number input
                return tf.tensor1d([input]);
            } else if (Array.isArray(input)) {
                if (input.length === 0) {
                    throw new Error('Input array cannot be empty');
                }
                if (input.some(val => typeof val !== 'number')) {
                    throw new Error('All array elements must be numbers');
                }
                return tf.tensor1d(input);
            } else if (input instanceof tf.Tensor) {
                if (!input.shape || input.shape.length === 0) {
                    throw new Error('Invalid tensor shape');
                }
                return input.clone();
            }
            throw new Error('Invalid input type');
        });
    }

    public validateAndNormalize(tensor: tf.Tensor, expectedShape: number[]): tf.Tensor {
        return this.memoryManager.wrapWithMemoryManagement(() => {
            if (!this.memoryManager.validateVectorShape(tensor, expectedShape)) {
                throw new Error(`Invalid tensor shape. Expected ${expectedShape}, got ${tensor.shape}`);
            }
            // Normalize the tensor
            return tf.div(tensor, tf.norm(tensor));
        });
    }
    public async encodeText(text: string, maxLength: number = 768): Promise<tf.Tensor> {
        return this.memoryManager.wrapWithMemoryManagement(() => {
            const encoded = new TextEncoder().encode(text);
            const padded = new Uint8Array(maxLength);
            padded.set(encoded.slice(0, maxLength));
            // Ensure we fill remaining space with zeros
            for (let i = encoded.length; i < maxLength; i++) {
                padded[i] = 0;
            }
            return tf.tensor1d(Array.from(padded));
        });
    }
}

export class AutomaticMemoryMaintenance {
    private static instance: AutomaticMemoryMaintenance;
    private memoryManager: MemoryManager;
    private maintenanceInterval: NodeJS.Timeout | null = null;

    private constructor() {
        this.memoryManager = MemoryManager.getInstance();
        this.startMaintenanceLoop();
    }

    public static getInstance(): AutomaticMemoryMaintenance {
        if (!AutomaticMemoryMaintenance.instance) {
            AutomaticMemoryMaintenance.instance = new AutomaticMemoryMaintenance();
        }
        return AutomaticMemoryMaintenance.instance;
    }

    private startMaintenanceLoop(): void {
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
        }
        this.maintenanceInterval = setInterval(() => {
            this.performMaintenance();
        }, 300000); // Run every 5 minutes
    }

    private performMaintenance(): void {
        this.memoryManager.wrapWithMemoryManagement(() => {
            // Check memory usage
            const memoryInfo = tf.memory();
            if (memoryInfo.numTensors > 1000 || memoryInfo.numBytes > 1e8) {
                tf.engine().disposeVariables();
                const tensors = tf.engine().state.numTensors;
                tf.disposeVariables();
                tf.dispose();
            }
        });
    }

    public dispose(): void {
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
            this.maintenanceInterval = null;
        }
    }
}

// Utility functions for tensor operations
export function checkNullOrUndefined(value: any): boolean {
    return value === null || value === undefined;
}

export function validateTensor(tensor: tf.Tensor | null | undefined): boolean {
    return !checkNullOrUndefined(tensor) && !tensor!.isDisposed;
}

export function validateTensorShape(tensor: tf.Tensor | null | undefined, expectedShape: number[]): boolean {
    if (!validateTensor(tensor)) return false;
    const shape = tensor!.shape;
    if (shape.length !== expectedShape.length) return false;
    return shape.every((dim, i) => expectedShape[i] === -1 || expectedShape[i] === dim);
}

// Safe tensor operations that handle null checks
export class SafeTensorOps {
    static reshape(tensor: tf.Tensor, shape: number[]): tf.Tensor {
        if (!validateTensor(tensor)) {
            throw new Error('Invalid tensor for reshape operation');
        }
        return tf.reshape(tensor, shape);
    }

    static matMul(a: tf.Tensor, b: tf.Tensor): tf.Tensor {
        if (!validateTensor(a) || !validateTensor(b)) {
            throw new Error('Invalid tensors for matMul operation');
        }
        return tf.matMul(a, b);
    }

    static add(a: tf.Tensor, b: tf.Tensor): tf.Tensor {
        if (!validateTensor(a) || !validateTensor(b)) {
            throw new Error('Invalid tensors for add operation');
        }
        return tf.add(a, b);
    }

    static sub(a: tf.Tensor, b: tf.Tensor): tf.Tensor {
        if (!validateTensor(a) || !validateTensor(b)) {
            throw new Error('Invalid tensors for sub operation');
        }
        return tf.sub(a, b);
    }

    static mul(a: tf.Tensor, b: tf.Tensor): tf.Tensor {
        if (!validateTensor(a) || !validateTensor(b)) {
            throw new Error('Invalid tensors for mul operation');
        }
        return tf.mul(a, b);
    }

    static div(a: tf.Tensor, b: tf.Tensor): tf.Tensor {
        if (!validateTensor(a) || !validateTensor(b)) {
            throw new Error('Invalid tensors for div operation');
        }
        return tf.div(a, b);
    }
} 