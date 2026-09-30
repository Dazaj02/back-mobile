export type EnrichInput = {
  chunks: string[];
  includeQuiz: boolean;
  model: string;
  apiKey: string;
  signal: AbortSignal;
  /** Segundo intento: se reenvía la salida anterior y el error de validación. */
  repair?: { previous: string; error: string };
};

export type TestInput = { model: string; apiKey: string; signal: AbortSignal };

export interface AIProvider {
  id: string;
  /** Devuelve el JSON ya parseado, o el texto crudo si no se pudo parsear. */
  enrich(input: EnrichInput): Promise<unknown>;
  /** Llamada mínima para comprobar la key. Lanza AppError con el código del contrato. */
  test(input: TestInput): Promise<void>;
}
