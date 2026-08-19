import {
  CommandEnvelopeSchema,
  SessionAbortAcceptedPayloadSchema,
  SessionPromptAcceptedPayloadSchema,
  createEnvelope,
  type AgentProviderRuntimeConfig,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { resolveChatAssistantRuntimeContext } from "../chat-assistant-runtime-context";
import {
  assertModelRunSettings,
  resolveModelRunSettings
} from "../model-run-settings";
import { createUsageRunContext } from "../usage-observation";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";

export async function handleSessionCommands(
  ctx: IpcCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
      if (command.type === "session.abort") {
        try {
          const internalCommand = CommandEnvelopeSchema.parse(
            createEnvelope(
              "agent.abort",
              command.payload,
              { id: command.id, context: command.context }
            )
          );
          const result = await ctx.supervisor.requestCommand("agent", internalCommand, 10_000);
          if (result.status === "accepted") {
            const accepted = SessionAbortAcceptedPayloadSchema.parse(result.payload);
            if (
              accepted.sessionId !== command.payload.sessionId ||
              accepted.runId !== command.payload.runId
            ) {
              return {
                status: "rejected",
                requestId: command.id,
                error: {
                  code: "ipc.invalid_agent_abort_result",
                  message: "Agent abort result does not match the requested run."
                }
              };
            }
            return { status: "accepted", requestId: command.id, payload: accepted };
          }
          return result;
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "ipc.agent_abort_failed",
              message: error instanceof Error ? error.message : "Agent abort failed.",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "session.prompt") {
        try {
          const runtimeConfig = await ctx.requireModelConfigStore().resolve(command.payload.modelId);
          const chatAssistantRuntimeContext =
            command.payload.mode === "chat-assistant"
              ? await resolveChatAssistantRuntimeContext(
                  ctx.supervisor,
                  command.payload,
                  {
                    requireModelConfigStore: ctx.requireModelConfigStore,
                    requireModelUsageStore: ctx.requireModelUsageStore,
                    requireChatAssistantProjectConfigStore: ctx.requireChatAssistantProjectConfigStore,
                    getAppVersion: ctx.getAppVersion
                  }
                )
              : undefined;
          const shortWorkspace = command.payload.workspaceContext?.shortWorkspace;
          const scriptWorkspace = command.payload.workspaceContext?.scriptWorkspace;
          const longWorkspace = command.payload.workspaceContext?.longWorkspace;
          const libraryWorkspace = command.payload.workspaceContext?.libraryWorkspace;
          const learningImitation = command.payload.workspaceContext?.learningImitation;
          const creativeWorkspace = shortWorkspace ?? scriptWorkspace;
          const creativeWorkspaceType = scriptWorkspace ? "script" : "short";
          const agentProfile = creativeWorkspace
            ? await ctx.requireWorkspaceAgentConfigStore().resolveForWorkspace(
                creativeWorkspace,
                creativeWorkspaceType
              )
            : undefined;
          const longAgentProfile = longWorkspace
            ? await ctx.requireLongAgentConfigStore().resolve(
                longWorkspace.activeAgentId
              )
            : undefined;
          const subagentDefinitions = agentProfile
            ? await ctx.requireAgentTeamConfigStore().resolve(
                creativeWorkspaceType,
                agentProfile.id
              )
            : longAgentProfile
              ? await ctx.requireLongAgentTeamConfigStore().resolve(
                  longAgentProfile.id
                )
              : undefined;
          const subagentRuntimeConfigs: Record<string, AgentProviderRuntimeConfig> =
            {};
          if (subagentDefinitions?.length) {
            for (const definition of subagentDefinitions) {
              if (definition.modelMode !== "custom" || !definition.modelId) {
                continue;
              }
              const resolved =
                subagentRuntimeConfigs[definition.modelId] ??
                (await ctx.requireModelConfigStore().resolve(definition.modelId));
              if (!resolved) {
                throw new Error(
                  `子智能体「${definition.name}」配置的模型不存在，请刷新模型配置后重试。`
                );
              }
              assertModelRunSettings(resolved, {
                thinkingLevel: definition.thinkingLevel,
                temperature: definition.temperature
              });
              subagentRuntimeConfigs[definition.modelId] = resolved;
            }
          }
          const libraryAgentProfile = libraryWorkspace
            ? await ctx.requireLibraryAgentConfigStore().resolve(
                libraryWorkspace.domain
              )
            : undefined;
          const learningImitationProfile = learningImitation
            ? await ctx.requireLearningImitationConfigStore().resolve(
                learningImitation.stageId
              )
            : undefined;
          const { thinkingLevel, temperature } = resolveModelRunSettings(runtimeConfig, {
            thinkingLevel: command.payload.thinkingLevel,
            temperature: command.payload.temperature
          });
          const {
            thinkingLevel: _requestedThinkingLevel,
            temperature: _requestedTemperature,
            ...promptPayload
          } = command.payload;
          const usageContext = createUsageRunContext(
            command.payload,
            runtimeConfig,
            subagentRuntimeConfigs
          );
          ctx.pendingUsageContexts.set(command.context.correlationId, usageContext);
          const internalCommand = CommandEnvelopeSchema.parse(
            createEnvelope(
              "agent.prompt",
              {
                ...promptPayload,
                ...(thinkingLevel ? { thinkingLevel } : {}),
                ...(temperature !== undefined ? { temperature } : {}),
                ...(runtimeConfig ? { runtimeConfig } : {}),
                ...(chatAssistantRuntimeContext
                  ? { chatAssistantRuntimeContext }
                  : {}),
                ...(agentProfile
                  ? scriptWorkspace
                    ? { scriptAgentProfile: agentProfile }
                    : { agentProfile }
                  : {}),
                ...(longAgentProfile ? { longAgentProfile } : {}),
                ...(subagentDefinitions ? { subagentDefinitions } : {}),
                ...(Object.keys(subagentRuntimeConfigs).length > 0
                  ? { subagentRuntimeConfigs }
                  : {}),
                ...(libraryAgentProfile ? { libraryAgentProfile } : {}),
                ...(learningImitationProfile ? { learningImitationProfile } : {})
              },
              { id: command.id, context: command.context }
            )
          );
          const result = await ctx.supervisor.requestCommand("agent", internalCommand, 10_000);
          if (result.status === "accepted") {
            const accepted = SessionPromptAcceptedPayloadSchema.parse(result.payload);
            if (accepted.sessionId !== command.payload.sessionId) {
              return {
                status: "rejected",
                requestId: command.id,
                error: {
                  code: "ipc.invalid_agent_acceptance",
                  message: "Agent acceptance sessionId does not match the prompt command."
                }
              };
            }
            const provisional = [...ctx.activeRuns.entries()].find(
              ([, run]) => run.correlationId === command.context.correlationId
            );
            if (provisional && provisional[0] !== accepted.runId) {
              return {
                status: "rejected",
                requestId: command.id,
                error: {
                  code: "ipc.invalid_agent_acceptance",
                  message: "Agent acceptance runId does not match the provisional event stream."
                }
              };
            }
            if (!ctx.terminalRuns.has(accepted.runId)) {
              ctx.activeRuns.set(accepted.runId, {
                sessionId: accepted.sessionId,
                correlationId: command.context.correlationId,
                runtime: accepted.runtime,
                accepted: true,
                promptRequestId: internalCommand.id,
                usageContext,
                ...(longWorkspace
                  ? { resourceId: longWorkspace.bookId }
                  : chatAssistantRuntimeContext?.mode === "project" &&
                      chatAssistantRuntimeContext.project.projectType === "long"
                    ? {
                        resourceId:
                          chatAssistantRuntimeContext.project.projectId
                      }
                    : {})
              });
            }
            ctx.pendingUsageContexts.delete(command.context.correlationId);
            return { status: "accepted", requestId: command.id, payload: accepted };
          }
          ctx.pendingUsageContexts.delete(command.context.correlationId);
          return result;
        } catch (error: unknown) {
          ctx.pendingUsageContexts.delete(command.context.correlationId);
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "ipc.agent_command_failed",
              message: error instanceof Error ? error.message : "Agent command failed.",
              details: safeErrorDetails(error)
            }
          };
        }
      }
  return undefined;
}
