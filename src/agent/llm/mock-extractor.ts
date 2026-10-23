import type { Extraction } from './extraction.schema';
import type { ExtractionContext, LlmExtractorPort } from './llm-extractor.port';

// Extracciones fijas para probar el flujo sin el modelo real.
export const MOCK_EXTRACTIONS = {
  // Ejemplo de la sección 7.3 del contrato.
  completeInvoice: {
    intent: 'create_invoice',
    customer: { document_type: 'CC', document_number: '1032456789' },
    items: [
      { description: 'Cambio de aceite', quantity: 1, unit_price: '80000.00' },
      { description: 'Filtro', quantity: 1, unit_price: '25000.00' },
    ],
    payment: { method: 'cash', amount: null },
    related_ids: { invoice_id: null, receipt_number: null, external_ref: null },
    missing_fields: [],
    notes: null,
  },
  missingDocument: {
    intent: 'create_invoice',
    customer: { document_type: null, document_number: null },
    items: [
      { description: 'Cambio de aceite', quantity: 1, unit_price: '80000.00' },
    ],
    payment: { method: null, amount: null },
    related_ids: { invoice_id: null, receipt_number: null, external_ref: null },
    missing_fields: ['customer.document_number'],
    notes: null,
  },
  unknownIntent: {
    intent: 'unknown',
    customer: { document_type: null, document_number: null },
    items: [],
    payment: { method: null, amount: null },
    related_ids: { invoice_id: null, receipt_number: null, external_ref: null },
    missing_fields: [],
    notes: null,
  },
} satisfies Record<string, Extraction>;

type MockResponse = Extraction | Error;

export class MockExtractor implements LlmExtractorPort {
  readonly calls: Array<{ text: string; context?: ExtractionContext }> = [];
  private response: MockResponse;

  constructor(response: MockResponse = MOCK_EXTRACTIONS.completeInvoice) {
    this.response = response;
  }

  // Cambia lo que devuelven las siguientes llamadas; un Error se lanza.
  respondWith(response: MockResponse): void {
    this.response = response;
  }

  extract(text: string, context?: ExtractionContext): Promise<Extraction> {
    this.calls.push({ text, context });
    if (this.response instanceof Error) {
      return Promise.reject(this.response);
    }
    return Promise.resolve(structuredClone(this.response));
  }
}
