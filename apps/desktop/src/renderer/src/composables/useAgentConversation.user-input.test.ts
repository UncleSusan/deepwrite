import {
  createDeferredApi,
  createEnvelope,
  describe,
  document,
  eventOptions,
  expect,
  it,
  reactive,
  runtime,
  useAgentConversation,
  vi
} from "./useAgentConversation.test-support";

function userInputEvent(
  sessionId: string,
  runId: string,
  requestId: string,
  question: string
) {
  return createEnvelope(
    "agent.user_input_requested",
    {
      sessionId,
      runId,
      requestId,
      toolCallId: `tool_${requestId}`,
      source: "ask_user_question" as const,
      questions: [
        {
          id: "tone",
          question,
          options: [
            { id: "restrained", label: "克制" },
            { id: "intense", label: "强烈" }
          ]
        }
      ],
      runtime
    },
    eventOptions(sessionId, runId, `event_${requestId}`)
  );
}

async function startWaitingRun() {
  const deferred = createDeferredApi();
  const controller = useAgentConversation({
    api: () => deferred.api,
    idleTimeoutMs: 10_000
  });
  controller.draft.value = "开始处理";
  const sessionId = controller.sessionId.value;
  const runId = "run_waiting_for_user";
  const sending = controller.sendMessage(document);
  deferred.resolveAccepted(0, {
    sessionId,
    runId,
    acceptedAt: new Date().toISOString(),
    runtime
  });
  await sending;
  return { controller, deferred, runId, sessionId };
}

describe("agent conversation controller: user input continuity", () => {
  it("keeps the submitted card mounted until resumed output is visible", async () => {
    const { controller, deferred, runId, sessionId } = await startWaitingRun();
    const submitUserInput = vi
      .spyOn(deferred.api.session, "submitUserInput")
      .mockImplementation(async (payload) => {
        structuredClone(payload);
        return {
          sessionId: payload.sessionId,
          runId: payload.runId,
          requestId: payload.requestId,
          resolvedAt: new Date().toISOString()
        };
      });
    controller.handleEvent(
      userInputEvent(sessionId, runId, "request_tone", "选择叙事语气")
    );

    const reactiveSelections = reactive({ tone: ["restrained"] });
    expect(() => structuredClone(reactiveSelections.tone)).toThrow();
    await expect(
      controller.submitUserInput([
        { id: "tone", selectedOptionIds: reactiveSelections.tone }
      ])
    ).resolves.toBe(true);

    expect(submitUserInput).toHaveBeenCalledWith({
      sessionId,
      runId,
      requestId: "request_tone",
      answers: [{ id: "tone", selectedOptionIds: ["restrained"] }]
    });
    expect(controller.pendingUserInput.value?.requestId).toBe("request_tone");
    expect(controller.submittingUserInput.value).toBe(true);

    controller.handleEvent(
      createEnvelope(
        "agent.thinking_delta",
        {
          sessionId,
          runId,
          messageId: "message_after_answer",
          delta: "继续处理用户回答",
          runtime
        },
        eventOptions(sessionId, runId, "evt_after_user_input")
      )
    );

    expect(controller.pendingUserInput.value).toBeNull();
    expect(controller.submittingUserInput.value).toBe(false);
    expect(controller.isBusy.value).toBe(true);
    controller.dispose();
  });

  it("replaces a submitted card directly with the next question", async () => {
    const { controller, deferred, runId, sessionId } = await startWaitingRun();
    vi.spyOn(deferred.api.session, "submitUserInput").mockImplementation(
      async (payload) => ({
        sessionId: payload.sessionId,
        runId: payload.runId,
        requestId: payload.requestId,
        resolvedAt: new Date().toISOString()
      })
    );
    controller.handleEvent(
      userInputEvent(sessionId, runId, "request_tone", "选择叙事语气")
    );
    await controller.submitUserInput([
      { id: "tone", selectedOptionIds: ["restrained"] }
    ]);

    controller.handleEvent(
      userInputEvent(sessionId, runId, "request_pace", "选择叙事节奏")
    );

    expect(controller.pendingUserInput.value).toMatchObject({
      requestId: "request_pace",
      questions: [{ question: "选择叙事节奏" }]
    });
    expect(controller.submittingUserInput.value).toBe(false);
    controller.dispose();
  });
});
