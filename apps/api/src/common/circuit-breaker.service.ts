import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime?: number;
  nextAttemptTime?: number;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private circuits: Map<string, CircuitBreakerStats> = new Map();

  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeout: number;

  constructor(private configService: ConfigService) {
    this.failureThreshold = this.configService.get<number>(
      'CIRCUIT_BREAKER_FAILURE_THRESHOLD',
      5,
    );
    this.successThreshold = this.configService.get<number>(
      'CIRCUIT_BREAKER_SUCCESS_THRESHOLD',
      2,
    );
    this.timeout = this.configService.get<number>(
      'CIRCUIT_BREAKER_TIMEOUT',
      60000,
    );
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(
    circuitName: string,
    fn: () => Promise<T>,
    fallback?: () => Promise<T>,
  ): Promise<T> {
    const circuit = this.getOrCreateCircuit(circuitName);

    // Check if circuit is OPEN
    if (circuit.state === CircuitState.OPEN) {
      const now = Date.now();
      if (now < circuit.nextAttemptTime!) {
        this.logger.warn(
          `Circuit breaker ${circuitName} is OPEN. Rejecting request. Next attempt in ${Math.ceil((circuit.nextAttemptTime! - now) / 1000)}s`,
        );
        if (fallback) {
          return fallback();
        }
        throw new Error(
          `Circuit breaker ${circuitName} is OPEN. Service temporarily unavailable.`,
        );
      }
      // Transition to HALF_OPEN to test if service recovered
      circuit.state = CircuitState.HALF_OPEN;
      circuit.successes = 0;
      this.logger.log(`Circuit breaker ${circuitName} transitioning to HALF_OPEN`);
    }

    try {
      const result = await fn();
      this.onSuccess(circuitName);
      return result;
    } catch (error) {
      this.onFailure(circuitName);
      throw error;
    }
  }

  /**
   * Record a successful execution
   */
  private onSuccess(circuitName: string): void {
    const circuit = this.getOrCreateCircuit(circuitName);

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.successes++;
      if (circuit.successes >= this.successThreshold) {
        this.logger.log(
          `Circuit breaker ${circuitName} recovered. Transitioning to CLOSED`,
        );
        circuit.state = CircuitState.CLOSED;
        circuit.failures = 0;
        circuit.successes = 0;
      }
    } else if (circuit.state === CircuitState.CLOSED) {
      circuit.failures = 0;
    }
  }

  /**
   * Record a failed execution
   */
  private onFailure(circuitName: string): void {
    const circuit = this.getOrCreateCircuit(circuitName);
    circuit.failures++;
    circuit.lastFailureTime = Date.now();

    if (circuit.state === CircuitState.HALF_OPEN) {
      this.logger.warn(
        `Circuit breaker ${circuitName} failed in HALF_OPEN state. Transitioning back to OPEN`,
      );
      circuit.state = CircuitState.OPEN;
      circuit.nextAttemptTime = Date.now() + this.timeout;
    } else if (
      circuit.state === CircuitState.CLOSED &&
      circuit.failures >= this.failureThreshold
    ) {
      this.logger.error(
        `Circuit breaker ${circuitName} failure threshold reached (${circuit.failures}/${this.failureThreshold}). Opening circuit`,
      );
      circuit.state = CircuitState.OPEN;
      circuit.nextAttemptTime = Date.now() + this.timeout;
    }
  }

  /**
   * Get circuit stats
   */
  getCircuitStats(circuitName: string): CircuitBreakerStats | undefined {
    return this.circuits.get(circuitName);
  }

  /**
   * Get all circuits stats
   */
  getAllCircuitsStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    this.circuits.forEach((circuit, name) => {
      stats[name] = circuit;
    });
    return stats;
  }

  /**
   * Manually reset a circuit
   */
  resetCircuit(circuitName: string): void {
    const circuit = this.getOrCreateCircuit(circuitName);
    circuit.state = CircuitState.CLOSED;
    circuit.failures = 0;
    circuit.successes = 0;
    delete circuit.lastFailureTime;
    delete circuit.nextAttemptTime;
    this.logger.log(`Circuit breaker ${circuitName} manually reset`);
  }

  /**
   * Get or create a circuit
   */
  private getOrCreateCircuit(circuitName: string): CircuitBreakerStats {
    if (!this.circuits.has(circuitName)) {
      this.circuits.set(circuitName, {
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
      });
    }
    return this.circuits.get(circuitName)!;
  }
}
