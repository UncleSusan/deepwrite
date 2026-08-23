import { ref, type Ref } from "vue";
import type {
  AgentUserInputAnswer,
  AgentUserInputRequestedPayload,
  DeepWriteApi
} from "@deepwrite/contracts";

export interface AgentUserInputController {
  request: Ref<AgentUserInputRequestedPayload | null>;
  submitting: Ref<boolean>;
  receive(request: AgentUserInputRequestedPayload): void;
  submit(answers: AgentUserInputAnswer[]): Promise<boolean>;
  clearSubmitted(runId: string): void;
  clear(runId?: string): void;
}

function cloneAnswersForIpc(
  answers: AgentUserInputAnswer[]
): AgentUserInputAnswer[] {
  return answers.map((answer) => ({
    id: answer.id,
    ...(answer.selectedOptionIds !== undefined
      ? { selectedOptionIds: [...answer.selectedOptionIds] }
      : {}),
    ...(answer.text !== undefined ? { text: answer.text } : {})
  }));
}

export function createAgentUserInputController(options: {
  api(): DeepWriteApi | undefined;
  onResume(runId: string): void;
  onError(message: string): void;
}): AgentUserInputController {
  const request = ref<AgentUserInputRequestedPayload | null>(null);
  const submitting = ref(false);

  function clear(runId?: string): void {
    if (runId && request.value?.runId !== runId) return;
    request.value = null;
    submitting.value = false;
  }

  async function submit(answers: AgentUserInputAnswer[]): Promise<boolean> {
    const pending = request.value;
    const api = options.api();
    if (!pending || !api || submitting.value) return false;
    submitting.value = true;
    try {
      const accepted = await api.session.submitUserInput({
        sessionId: pending.sessionId,
        runId: pending.runId,
        requestId: pending.requestId,
        answers: cloneAnswersForIpc(answers)
      });
      if (
        accepted.sessionId !== pending.sessionId ||
        accepted.runId !== pending.runId ||
        accepted.requestId !== pending.requestId
      ) {
        throw new Error("用户回答结果与当前请求不一致。");
      }
      if (request.value?.requestId === pending.requestId) {
        // Keep the resolved card mounted until the resumed run produces
        // visible output (or replaces it with another question). Otherwise
        // the normal composer flashes between consecutive runtime events.
        options.onResume(pending.runId);
      }
      return true;
    } catch (error: unknown) {
      if (request.value?.requestId === pending.requestId) {
        submitting.value = false;
        options.onError(
          error instanceof Error ? error.message : "提交用户回答失败。"
        );
      }
      return false;
    }
  }

  return {
    request,
    submitting,
    receive(nextRequest) {
      request.value = nextRequest;
      submitting.value = false;
    },
    submit,
    clearSubmitted(runId) {
      if (!submitting.value || request.value?.runId !== runId) return;
      clear(runId);
    },
    clear
  };
}
