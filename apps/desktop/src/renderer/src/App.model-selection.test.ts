import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

function functionBody(name: string, nextName: string): string {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  return source.slice(start, end);
}

describe("App agent model selection", () => {
  it("restores and persists the global model selection across app launches", () => {
    expect(source).toContain(
      "const sessionAgentModelSelection = ref<AgentModelSelection | undefined>(\n  loadAgentModelSelection()\n);"
    );
    const body = functionBody(
      "synchronizeSessionAgentModelSelection",
      "storeAgentRunPreferences"
    );
    expect(body).toContain("AGENT_MODEL_SELECTION_STORAGE_KEY");
    expect(body).toContain("JSON.stringify(selection)");
  });

  it("keeps the selected conversation stable while publishing a model change", () => {
    const body = functionBody("selectModel", "selectThinking");

    expect(body).toContain("const conversation = activeConversation.value;");
    expect(body).toContain("conversation.selectModel(modelId);");
    expect(body).toContain("synchronizeSessionAgentModelSelection(conversation);");
    expect(body.match(/activeConversation\.value/g)).toHaveLength(1);
  });

  it("keeps the selected conversation stable while publishing a thinking-level change", () => {
    const body = functionBody("selectThinking", "selectTemperature");

    expect(body).toContain("const conversation = activeConversation.value;");
    expect(body).toContain("conversation.selectThinkingLevel(level);");
    expect(body).toContain("synchronizeSessionAgentModelSelection(conversation);");
    expect(body.match(/activeConversation\.value/g)).toHaveLength(1);
  });
});
