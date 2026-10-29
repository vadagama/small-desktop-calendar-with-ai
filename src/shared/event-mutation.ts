export interface EventMutationReference {
  accountId: string;
  operationId: string;
}
export interface EventMutationResult {
  phase: "preview" | "submitting" | "succeeded" | "unknown" | "blocked";
  message: string;
}
