// @spec DFF-STATIC-033
export class InvariantError extends Error {
  // @spec DFF-STATIC-033
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}
