import { describe, expect, it } from "vitest";
import shellSource from "./WorkspaceShell.vue?raw";
import sidebarSource from "./components/LeftSidebar.vue?raw";
import lazySource from "./components/lazyAppComponents.ts?raw";
import overlaySource from "./features/chat-assistant/ChatAssistantOverlay.vue?raw";
import featureSource from "./features/chat-assistant/useChatAssistant.ts?raw";
import modeSource from "./features/chat-assistant/useChatAssistantMode.ts?raw";

describe("independent chat assistant feature", () => {
  it("places chat beside agent teams without replacing the workspace view", () => {
    const modelIndex = sidebarSource.indexOf('label: "模型配置"');
    const chatIndex = sidebarSource.indexOf('label: "聊天"');
    const teamIndex = sidebarSource.indexOf('label: "智能体团队"');
    expect(modelIndex).toBeGreaterThan(-1);
    expect(teamIndex).toBeGreaterThan(modelIndex);
    expect(chatIndex).toBeGreaterThan(teamIndex);
    expect(sidebarSource).toContain('emit("openChatAssistant")');
    expect(shellSource).toContain('@open-chat-assistant="chatAssistant.open"');
    expect(shellSource).toContain(
      "chatAssistant.active.value ? 'chat-assistant'"
    );
    expect(featureSource).not.toContain("workspaceMainView");
  });

  it("lazy-loads a teleported floating surface with minimize and history controls", () => {
    expect(lazySource).toContain(
      '() => import("../features/chat-assistant/ChatAssistantOverlay.vue")'
    );
    expect(shellSource).toContain('<Teleport to="body">');
    expect(shellSource).toContain('v-if="chatAssistant.visible.value');
    expect(overlaySource).toContain('aria-label="最小化聊天助手"');
    expect(overlaySource).toContain("visibleHistory");
    expect(overlaySource).toContain("查看全部");
    expect(overlaySource).toContain("selectConversation(item.sessionId)");
    expect(overlaySource).toContain("controller.value!.newConversation()");
    expect(overlaySource).toContain("width: min(44vw");
    expect(overlaySource).toContain("height: min(88vh");
    expect(overlaySource).toContain('aria-label="调整聊天窗口宽度"');
    expect(overlaySource).toContain('aria-label="调整聊天窗口高度"');
    expect(overlaySource).toContain("chat-assistant-resize-edge is-left");
    expect(overlaySource).toContain("chat-assistant-resize-edge is-top");
    expect(overlaySource).not.toContain("chat-assistant-resize-handle");
    expect(overlaySource).toContain('"deepwrite:chat-assistant-size:v2"');
  });

  it("isolates normal and per-project controllers and sends the selected context", () => {
    expect(modeSource).toContain('key: "chat-assistant:normal"');
    expect(modeSource).toContain("`chat-assistant:project:${suffix}`");
    expect(featureSource).toContain(
      '"chat-assistant",\n      "chat-assistant:normal"'
    );
    expect(modeSource).toContain("sendAssistantMessage(context)");
    expect(overlaySource).toContain("assistant.sendAssistantMessage()");
    expect(overlaySource).toContain("controller.stopGeneration()");
    expect(overlaySource).toContain("controller.thinkingLevel.value");
    expect(overlaySource).toContain('accessible-label="聊天模型"');
    expect(overlaySource).toContain(
      "controller.value!.selectModel(String(value))"
    );
    expect(overlaySource).toContain("controller.value!.configuredModels.value");
    expect(overlaySource).toContain("附件功能后续开放");
    expect(overlaySource).toContain("语音功能后续开放");
  });

  it("uses one context list and immutable book association in the project dialog", () => {
    expect(overlaySource).toContain('accessible-label="切换聊天上下文"');
    expect(overlaySource).toContain("context:normal");
    expect(overlaySource).toContain("+ 添加新项目配置");
    expect(overlaySource).not.toContain('class="chat-assistant-mode-tabs"');
    expect(overlaySource).toContain("编辑项目");
    expect(overlaySource).toContain('actionIcon: "edit"');
    expect(overlaySource).toContain('@option-action="openEditProject"');
    expect(overlaySource).not.toContain(
      'class="chat-assistant-project-action"'
    );
    expect(overlaySource).toContain('accessible-label="关联书籍"');
    expect(overlaySource).toContain(
      "projectConfigMode === 'edit' || projectConfigPending"
    );
    expect(overlaySource).toContain("关联书籍已锁定，不可更换");
    expect(modeSource).not.toContain("projectOptions.value[0].project");
    expect(overlaySource).toContain("恢复默认");
    expect(overlaySource).toContain("uiMessage.success");
    expect(overlaySource).toContain("可查询创作空间目录");
    expect(overlaySource).not.toContain('chat-assistant-context"');
    expect(overlaySource).toContain(
      "grid-template-rows: auto minmax(0, 1fr) auto"
    );
    expect(overlaySource).toContain("var(--theme-line)");
    expect(overlaySource).toContain("assistant.isBusy.value");
    expect(overlaySource).toContain("!assistant.projectAvailable.value");
  });
});
