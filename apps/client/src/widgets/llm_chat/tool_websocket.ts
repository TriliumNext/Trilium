/**
 * Tool WebSocket Manager
 * 
 * Provides real-time WebSocket communication for tool execution updates.
 * Implements automatic reconnection, heartbeat, and message queuing.
 */

import { EventEmitter } from 'events';

/**
 * WebSocket message types
 */
export enum WSMessageType {
    // Tool execution events
    TOOL_START = 'tool:start',
    TOOL_PROGRESS = 'tool:progress',
    TOOL_STEP = 'tool:step',
    TOOL_COMPLETE = 'tool:complete',
    TOOL_ERROR = 'tool:error',
    TOOL_CANCELLED = 'tool:cancelled',
    
    // Connection events
    HEARTBEAT = 'heartbeat',
    PING = 'ping',
    PONG = 'pong',
    
    // Control events
    SUBSCRIBE = 'subscribe',
    UNSUBSCRIBE = 'unsubscribe',
}

/**
 * WebSocket message structure
 */
export interface WSMessage {
    id: string;
    type: WSMessageType;
    timestamp: string;
    data: any;
}

/**
 * WebSocket configuration
 */
export interface WSConfig {
    url: string;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
    heartbeatInterval?: number;
    messageTimeout?: number;
    autoReconnect?: boolean;
}

/**
 * Connection state
 */
export enum ConnectionState {
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
    RECONNECTING = 'reconnecting',
    DISCONNECTED = 'disconnected',
    FAILED = 'failed'
}

/**
 * Tool WebSocket Manager
 */
export class ToolWebSocketManager extends EventEmitter {
    private ws?: WebSocket;
    private config: Required<WSConfig>;
    private state: ConnectionState = ConnectionState.DISCONNECTED;
    private reconnectAttempts: number = 0;
    private reconnectTimer?: number;
    private heartbeatTimer?: number;
    private messageQueue: WSMessage[] = [];
    private subscriptions: Set<string> = new Set();
    private lastPingTime?: number;
    private lastPongTime?: number;
    
    // Performance constants
    private static readonly DEFAULT_RECONNECT_INTERVAL = 3000;
    private static readonly DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
    private static readonly DEFAULT_HEARTBEAT_INTERVAL = 30000;
    private static readonly DEFAULT_MESSAGE_TIMEOUT = 5000;
    private static readonly MAX_QUEUE_SIZE = 100;

    constructor(config: WSConfig) {
        super();
        
        this.config = {
            url: config.url,
            reconnectInterval: config.reconnectInterval ?? ToolWebSocketManager.DEFAULT_RECONNECT_INTERVAL,
            maxReconnectAttempts: config.maxReconnectAttempts ?? ToolWebSocketManager.DEFAULT_MAX_RECONNECT_ATTEMPTS,
            heartbeatInterval: config.heartbeatInterval ?? ToolWebSocketManager.DEFAULT_HEARTBEAT_INTERVAL,
            messageTimeout: config.messageTimeout ?? ToolWebSocketManager.DEFAULT_MESSAGE_TIMEOUT,
            autoReconnect: config.autoReconnect ?? true
        };
    }

    /**
     * Connect to WebSocket server
     */
    public connect(): void {
        if (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.CONNECTING) {
            return;
        }

        this.state = ConnectionState.CONNECTING;
        this.emit('connecting');

        try {
            this.ws = new WebSocket(this.config.url);
            this.setupEventHandlers();
        } catch (error) {
            this.handleConnectionError(error);
        }
    }

    /**
     * Setup WebSocket event handlers
     */
    private setupEventHandlers(): void {
        if (!this.ws) return;

        this.ws.onopen = () => {
            this.state = ConnectionState.CONNECTED;
            this.reconnectAttempts = 0;
            this.emit('connected');
            
            // Start heartbeat
            this.startHeartbeat();
            
            // Re-subscribe to previous subscriptions
            this.resubscribe();
            
            // Flush message queue
            this.flushMessageQueue();
        };

        this.ws.onmessage = (event) => {
            try {
                const message: WSMessage = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.emit('error', error);
        };

        this.ws.onclose = (event) => {
            this.state = ConnectionState.DISCONNECTED;
            this.stopHeartbeat();
            this.emit('disconnected', event.code, event.reason);
            
            if (this.config.autoReconnect && !event.wasClean) {
                this.scheduleReconnect();
            }
        };
    }

    /**
     * Handle incoming message
     */
    private handleMessage(message: WSMessage): void {
        // Handle control messages
        switch (message.type) {
            case WSMessageType.PONG:
                this.lastPongTime = Date.now();
                return;
                
            case WSMessageType.HEARTBEAT:
                this.send({
                    id: message.id,
                    type: WSMessageType.PONG,
                    timestamp: new Date().toISOString(),
                    data: null
                });
                return;
        }

        // Emit message for subscribers
        this.emit('message', message);
        this.emit(message.type, message.data);
    }

    /**
     * Send a message
     */
    public send(message: WSMessage): void {
        if (this.state === ConnectionState.CONNECTED && this.ws?.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(message));
            } catch (error) {
                console.error('Failed to send WebSocket message:', error);
                this.queueMessage(message);
            }
        } else {
            this.queueMessage(message);
        }
    }

    /**
     * Queue a message for later sending
     */
    private queueMessage(message: WSMessage): void {
        if (this.messageQueue.length >= ToolWebSocketManager.MAX_QUEUE_SIZE) {
            this.messageQueue.shift(); // Remove oldest message
        }
        this.messageQueue.push(message);
    }

    /**
     * Flush message queue
     */
    private flushMessageQueue(): void {
        while (this.messageQueue.length > 0 && this.state === ConnectionState.CONNECTED) {
            const message = this.messageQueue.shift();
            if (message) {
                this.send(message);
            }
        }
    }

    /**
     * Subscribe to tool execution updates
     */
    public subscribe(executionId: string): void {
        this.subscriptions.add(executionId);
        
        if (this.state === ConnectionState.CONNECTED) {
            this.send({
                id: this.generateMessageId(),
                type: WSMessageType.SUBSCRIBE,
                timestamp: new Date().toISOString(),
                data: { executionId }
            });
        }
    }

    /**
     * Unsubscribe from tool execution updates
     */
    public unsubscribe(executionId: string): void {
        this.subscriptions.delete(executionId);
        
        if (this.state === ConnectionState.CONNECTED) {
            this.send({
                id: this.generateMessageId(),
                type: WSMessageType.UNSUBSCRIBE,
                timestamp: new Date().toISOString(),
                data: { executionId }
            });
        }
    }

    /**
     * Re-subscribe to all previous subscriptions
     */
    private resubscribe(): void {
        this.subscriptions.forEach(executionId => {
            this.send({
                id: this.generateMessageId(),
                type: WSMessageType.SUBSCRIBE,
                timestamp: new Date().toISOString(),
                data: { executionId }
            });
        });
    }

    /**
     * Start heartbeat mechanism
     */
    private startHeartbeat(): void {
        this.stopHeartbeat();
        
        this.heartbeatTimer = window.setInterval(() => {
            if (this.state === ConnectionState.CONNECTED) {
                // Check if last pong was received
                if (this.lastPingTime && this.lastPongTime) {
                    const timeSinceLastPong = Date.now() - this.lastPongTime;
                    if (timeSinceLastPong > this.config.heartbeatInterval * 2) {
                        // Connection seems dead, reconnect
                        this.reconnect();
                        return;
                    }
                }
                
                // Send ping
                this.lastPingTime = Date.now();
                this.send({
                    id: this.generateMessageId(),
                    type: WSMessageType.PING,
                    timestamp: new Date().toISOString(),
                    data: null
                });
            }
        }, this.config.heartbeatInterval);
    }

    /**
     * Stop heartbeat mechanism
     */
    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }

    /**
     * Schedule reconnection attempt
     */
    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
            this.state = ConnectionState.FAILED;
            this.emit('failed', 'Max reconnection attempts reached');
            return;
        }

        this.state = ConnectionState.RECONNECTING;
        this.reconnectAttempts++;
        
        const delay = Math.min(
            this.config.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1),
            30000 // Max 30 seconds
        );
        
        this.emit('reconnecting', this.reconnectAttempts, delay);
        
        this.reconnectTimer = window.setTimeout(() => {
            this.connect();
        }, delay);
    }

    /**
     * Reconnect to server
     */
    public reconnect(): void {
        this.disconnect(false);
        this.connect();
    }

    /**
     * Handle connection error
     */
    private handleConnectionError(error: any): void {
        console.error('WebSocket connection error:', error);
        this.state = ConnectionState.DISCONNECTED;
        this.emit('error', error);
        
        if (this.config.autoReconnect) {
            this.scheduleReconnect();
        }
    }

    /**
     * Disconnect from server
     */
    public disconnect(clearSubscriptions: boolean = true): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        
        this.stopHeartbeat();
        
        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
            this.ws = undefined;
        }
        
        if (clearSubscriptions) {
            this.subscriptions.clear();
        }
        
        this.messageQueue = [];
        this.state = ConnectionState.DISCONNECTED;
    }

    /**
     * Get connection state
     */
    public getState(): ConnectionState {
        return this.state;
    }

    /**
     * Check if connected
     */
    public isConnected(): boolean {
        return this.state === ConnectionState.CONNECTED;
    }

    /**
     * Generate unique message ID
     */
    private generateMessageId(): string {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Destroy the WebSocket manager
     */
    public destroy(): void {
        this.disconnect(true);
        this.removeAllListeners();
    }
}

/**
 * Create WebSocket manager instance
 */
export function createToolWebSocket(config: WSConfig): ToolWebSocketManager {
    return new ToolWebSocketManager(config);
}