import React from 'react';
import ImagePreview from './ImagePreview';
import { formatMessageTimestamp } from '../utils/timeUtils';
import MarkdownContent from './MarkdownContent';
import ThinkingContent from './ThinkingContent';
import ToolCallWithResponse from './ToolCallWithResponse';
import {
  getTextAndImageContent,
  getThinkingContent,
  getToolConfirmationContent,
  getElicitationContent,
  ToolRequestMessageContent,
  ToolResponseMessageContent,
  ToolConfirmationData,
  NotificationEvent,
} from '../types/message';
import { Message } from '../api';
import ToolCallConfirmation from './ToolCallConfirmation';
import ElicitationRequest from './ElicitationRequest';
import MessageCopyLink from './MessageCopyLink';
import { cn } from '../utils';
import { shouldHideTimestamp } from '../utils/toolCallChaining';

interface GooseMessageProps {
  sessionId: string;
  message: Message;
  messageIndex: number;
  toolCallChains: [number, number][];
  metadata?: string[];
  toolRequests: ToolRequestMessageContent[];
  toolResponsesMap: Map<string, ToolResponseMessageContent>;
  findConfirmationForTool: (toolRequestId: string) => ToolConfirmationData | undefined;
  pendingConfirmationIds: Set<string>;
  inlineConfirmationIds: Set<string>;
  toolCallNotifications: Map<string, NotificationEvent[]>;
  append: (value: string) => void;
  isStreaming: boolean;
  submitElicitationResponse?: (
    elicitationId: string,
    userData: Record<string, unknown>
  ) => Promise<void>;
}

const GooseMessageInner = ({
  sessionId,
  message,
  messageIndex,
  toolCallChains,
  toolRequests,
  toolResponsesMap,
  findConfirmationForTool,
  pendingConfirmationIds,
  inlineConfirmationIds,
  toolCallNotifications,
  append,
  isStreaming,
  submitElicitationResponse,
}: GooseMessageProps) => {
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  const { textContent: displayText, imagePaths } = getTextAndImageContent(message);
  const thinkingContent = getThinkingContent(message);

  const timestamp = formatMessageTimestamp(message.created);
  const toolConfirmationContent = getToolConfirmationContent(message);
  const elicitationContent = getElicitationContent(message);
  const hideTimestamp = shouldHideTimestamp(messageIndex, toolCallChains);

  const hasToolConfirmation = toolConfirmationContent !== undefined;
  const hasElicitation = elicitationContent !== undefined;

  // Pre-compute tool request rows to avoid repeated lookups in JSX render loop
  const toolRequestRows = toolRequests.map((toolRequest) => {
    const hasResponse = toolResponsesMap.has(toolRequest.id);
    const isPending = pendingConfirmationIds.has(toolRequest.id);
    const confirmationContent = findConfirmationForTool(toolRequest.id);
    const isApprovalClicked = confirmationContent && !isPending && hasResponse;
    return { toolRequest, hasResponse, isPending, confirmationContent, isApprovalClicked };
  });

  // Check if confirmation is shown inline — any tool request that got confirmation
  // content via findConfirmationForTool means it's rendered inline in the tool row.
  const toolConfirmationShownInline = toolRequestRows.some(
    (row) => row.confirmationContent !== undefined
  );

  return (
    <div className="goose-message flex w-[90%] justify-start min-w-0">
      <div className="flex flex-col w-full min-w-0">
        {thinkingContent && (
          <ThinkingContent
            content={thinkingContent}
            isExpanded={
              isStreaming &&
              !displayText.trim() &&
              imagePaths.length === 0 &&
              toolRequests.length === 0
            }
          />
        )}

        {(displayText.trim() || imagePaths.length > 0) && (
          <div className="flex flex-col group">
            {displayText.trim() && (
              <div ref={contentRef} className="w-full">
                <MarkdownContent content={displayText} />
              </div>
            )}

            {imagePaths.length > 0 && (
              <div className="mt-4">
                {imagePaths.map((imagePath, index) => (
                  <ImagePreview key={index} src={imagePath} />
                ))}
              </div>
            )}

            {toolRequests.length === 0 && (
              <div className="relative flex justify-start">
                {!isStreaming && (
                  <div className="text-xs font-mono text-text-secondary pt-1 transition-all duration-200 group-hover:-translate-y-4 group-hover:opacity-0">
                    {timestamp}
                  </div>
                )}
                {message.content.every((content) => content.type === 'text') && !isStreaming && (
                  <div className="absolute left-0 pt-1">
                    <MessageCopyLink text={displayText} contentRef={contentRef} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {toolRequests.length > 0 && (
          <div className={cn(displayText && 'mt-2')}>
            <div className="relative flex flex-col w-full">
              <div className="flex flex-col gap-3">
                {toolRequestRows.map(({ toolRequest, hasResponse, isPending, confirmationContent, isApprovalClicked }) => (
                  <div className="goose-message-tool" key={toolRequest.id}>
                    <ToolCallWithResponse
                      sessionId={sessionId}
                      isCancelledMessage={false}
                      toolRequest={toolRequest}
                      toolResponse={toolResponsesMap.get(toolRequest.id)}
                      notifications={toolCallNotifications.get(toolRequest.id)}
                      isStreamingMessage={isStreaming}
                      isPendingApproval={isPending}
                      append={append}
                      confirmationContent={confirmationContent}
                      isApprovalClicked={isApprovalClicked}
                    />
                  </div>
                ))}
              </div>
              <div className="text-xs text-text-secondary transition-all duration-200 group-hover:-translate-y-4 group-hover:opacity-0 pt-1">
                {!isStreaming && !hideTimestamp && timestamp}
              </div>
            </div>
          </div>
        )}

        {hasToolConfirmation &&
          !toolConfirmationShownInline &&
          !inlineConfirmationIds.has(toolConfirmationContent!.data.id) && (
          <ToolCallConfirmation
            sessionId={sessionId}
            isClicked={false}
            actionRequiredContent={toolConfirmationContent}
          />
        )}

        {hasElicitation && submitElicitationResponse && (
          <ElicitationRequest
            isCancelledMessage={false}
            isClicked={false}
            actionRequiredContent={elicitationContent}
            onSubmit={submitElicitationResponse}
          />
        )}
      </div>
    </div>
  );
};

export default React.memo(GooseMessageInner);
