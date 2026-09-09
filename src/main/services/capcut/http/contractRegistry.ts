export type ContractState = 'unmapped' | 'captured' | 'fixture-verified' | 'live-verified' | 'disabled' | 'browser-required';
export type ContractFieldOrigin = 'static' | 'user-input' | 'session' | 'dependency';

export interface HttpContractField {
  readonly name: string;
  readonly origin: ContractFieldOrigin;
  readonly required: boolean;
}

export interface HttpContract {
  readonly operation: string;
  readonly revision: string;
  readonly origin: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly fields: readonly HttpContractField[];
  readonly state: ContractState;
  readonly fixture?: string;
}

export class HttpContractRegistry {
  private readonly contracts = new Map<string, HttpContract>();

  register(contract: HttpContract): void {
    if (!contract.operation.trim() || !contract.revision.trim()) throw new Error('HTTP_CONTRACT_ID_REQUIRED');
    if (!/^https:\/\/[^\s]+$/.test(contract.origin) || !contract.path.startsWith('/')) throw new Error('HTTP_CONTRACT_TARGET_INVALID');
    if (this.contracts.has(contract.operation)) throw new Error('HTTP_CONTRACT_DUPLICATE');
    this.contracts.set(contract.operation, Object.freeze({ ...contract, fields: Object.freeze([...contract.fields]) }));
  }

  registerMany(contracts: readonly HttpContract[]): void {
    for (const contract of contracts) this.register(contract);
  }

  static fromManifest(value: unknown): HttpContractRegistry {
    if (!Array.isArray(value)) throw new Error('HTTP_CONTRACT_MANIFEST_INVALID');
    const registry = new HttpContractRegistry();
    for (const item of value) {
      if (!item || typeof item !== 'object') throw new Error('HTTP_CONTRACT_MANIFEST_INVALID');
      const candidate = item as Partial<HttpContract>;
      if (!Array.isArray(candidate.fields) || typeof candidate.operation !== 'string' || typeof candidate.revision !== 'string' || typeof candidate.origin !== 'string' || typeof candidate.path !== 'string' || typeof candidate.method !== 'string' || typeof candidate.state !== 'string') {
        throw new Error('HTTP_CONTRACT_MANIFEST_INVALID');
      }
      registry.register(candidate as HttpContract);
    }
    return registry;
  }

  get(operation: string): HttpContract {
    const contract = this.contracts.get(operation);
    if (!contract) throw new Error('CONTRACT_UNAVAILABLE');
    return contract;
  }

  assertDispatchable(operation: string, values: Record<string, unknown>): HttpContract {
    const contract = this.get(operation);
    if (!['fixture-verified', 'live-verified'].includes(contract.state)) throw new Error('CONTRACT_UNAVAILABLE');
    for (const field of contract.fields) {
      if (field.required && (values[field.name] === undefined || values[field.name] === null || values[field.name] === '')) {
        throw new Error('HTTP_CONTRACT_FIELD_MISSING_' + field.name);
      }
    }
    return contract;
  }
}
