/**
 * ProgressiveMessageList Component
 *
 * A performance-optimized message list that renders messages progressively
 * to prevent UI blocking when loading long chat sessions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defineMessages, useIntl } from '../i18n';
import { Message, SystemNotificationContent } from '../api';
import GooseMessage from './GooseMessage';
import UserMessage from './UserMessage';
import {
  SystemNotificationInline,
  getInlineSystemNotification,
} from './context_management/SystemNotificationInline';
import {
  CreditsExhaustedNotification,
  getCreditsExhaustedNotification,
} from './context_management/CreditsExhaustedNotification';
import {
  NotificationEvent,
  getToolRequests,
  getToolResponses,
  getAnyToolConfirmationData,
  ToolConfirmationData,
  getPendingToolConfirmationIds,
} from '../types/message';
import LoadingGoose from './LoadingGoose';
import { ChatType } from '../types/chat';
import { identifyConsecutiveToolCalls, isInChain } from '../utils/toolCallChaining';

const i18n = defineMessages({
  loadingMessages: {
    id: 'progressiveMessageList.loadingMessages',
    defaultMessage: 'Loading messages... ({renderedCount}/{totalCount})',
  },
  searchHint: {
    id: 'progressiveMessageList.searchHint',
    defaultMessage: 'Press Cmd/Ctrl+F to load all messages immediately for search',
  },
});

// Per-message precomputed data - passed to GooseMessage via React.memo props
interface PerMessagePrecompute {
  toolRequests: ReturnType<typeof getToolRequests>;
  toolResponsesMap: Map<string, ReturnType<typeof getToolResponses>[0]>;
  findConfirmationForTool: (toolRequestId: string) => ToolConfirmationData | undefined;
}

interface RenderedMessage {
  message: Message;
  index: number;
}

interface ProgressiveMessageListProps {
  messages: Message[];
  chat: Pick<ChatType, 'sessionId'>;
  toolCallNotifications?: Map<string, NotificationEvent[]>;
  append?: (value: string) => void;
  isUserMessage: (message: Message) => boolean;
  batchSize?: number;
  batchDelay?: number;
  showLoadingThreshold?: number;
  renderMessage?: (message: Message, index: number) => React.ReactNode | null;
  isStreamingMessage?: boolean;
  onMessageUpdate?: (messageId: string, newContent: string, editType?: 'fork' | 'edit') => void;
  onRenderingComplete?: () => void;
  onScrollReady?: () => void;
  scrollReadyRef?: React.MutableRefObject<boolean | undefined>;
  submitElicitationResponse?: (
    elicitationId: string,
    userData: Record<string, unknown>
  ) => Promise<void>;
}

export default function ProgressiveMessageList({
  messages,
  chat,
  toolCallNotifications = new Map(),
  append = () => {},
  isUserMessage,
  batchSize = 20,
  batchDelay = 20,
  showLoadingThreshold = 50,
  renderMessage,
  isStreamingMessage = false,
  onMessageUpdate,
  onRenderingComplete,
  onScrollReady,
  scrollReadyRef,
  submitElicitationResponse,
}: ProgressiveMessageListProps) {
  const intl = useIntl();
  const [renderedCount, setRenderedCount] = useState(() => {
    if (messages.length <= showLoadingThreshold) {
      return messages.length;
    }
    // Start with one batch — matches renderedSet initial state
    return Math.min(batchSize, messages.length);
  });
  const [renderedSet, setRenderedSet] = useState<RenderedMessage[]>(() => {
    if (messages.length === 0) return [];
    // For small chats (<= showLoadingThreshold), render all messages immediately.
    // For larger chats, start with the last batch so there's real content for
    // the ScrollArea to scroll to; older messages are prepended progressively.
    const count =
      messages.length <= showLoadingThreshold
        ? messages.length
        : Math.min(batchSize, messages.length);
    return messages
      .slice(messages.length - count)
      .map((msg, i) => ({ message: msg, index: messages.length - count + i }));
  });
  const [isLoading, setIsLoading] = useState(() => messages.length > showLoadingThreshold);
  const prevMsgCountRef = useRef(messages.length);
  const timeoutRef = useRef<number | null>(null);
  // Gate batch loading on scroll completion
  const batchLoadingReadyRef = useRef(false);

  // Signal to parent that we have content and are ready to scroll.
  useEffect(() => {
    if (renderedSet.length > 0 && onScrollReady) {
      onScrollReady();
    }
  }, [onScrollReady, renderedSet.length]);

  // Called by parent after scroll succeeds — starts batch loading.
  useEffect(() => {
    if (scrollReadyRef && scrollReadyRef.current) {
      batchLoadingReadyRef.current = true;
    }
  }, [scrollReadyRef, scrollReadyRef?.current]);

  const hasOnlyToolResponses = (message: Message) =>
    message.content.every((c) => c.type === 'toolResponse');

  const getSystemNotification = (message: Message): SystemNotificationContent | undefined => {
    return getCreditsExhaustedNotification(message) ?? getInlineSystemNotification(message);
  };

  const renderSystemNotification = (notification: SystemNotificationContent) => {
    switch (notification.notificationType) {
      case 'creditsExhausted':
        return <CreditsExhaustedNotification notification={notification} />;
      case 'inlineMessage':
        return <SystemNotificationInline notification={notification} />;
      default:
        return null;
    }
  };

  useEffect(() => {
    if (messages.length <= showLoadingThreshold) {
      setRenderedCount(messages.length);
      setIsLoading(false);
      if (onRenderingComplete) {
        setTimeout(() => onRenderingComplete(), 50);
      }
      return;
    }

    // Wait for scroll to complete before starting batch loading.
    // This ensures the bottom message is pinned before content grows above it.
    if (!batchLoadingReadyRef.current) return;

    // Start batch loading
    const loadNextBatch = () => {
      const doneRef = { current: false };

      setRenderedCount((currentCount) => {
        const nextCount = Math.min(currentCount + batchSize, messages.length);
        doneRef.current = nextCount >= messages.length;

        // Prepend new messages to the rendered set (bottom-up)
        const startIdx = messages.length - nextCount;
        const endIdx = messages.length - currentCount;
        if (startIdx < endIdx) {
          const newMessages = messages.slice(startIdx, endIdx).map((msg, i) => ({
            message: msg,
            index: startIdx + i,
          }));
          setRenderedSet((prev) => [...newMessages, ...prev]); // prepend
        }

        return nextCount;
      });

      if (doneRef.current) {
        setIsLoading(false);
        if (onRenderingComplete) {
          setTimeout(() => onRenderingComplete(), 50);
        }
      } else {
        timeoutRef.current = window.setTimeout(loadNextBatch, batchDelay);
      }
    };

    timeoutRef.current = window.setTimeout(loadNextBatch, batchDelay);
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [messages.length, batchSize, batchDelay, showLoadingThreshold, renderedCount, onRenderingComplete]);

  // Sync renderedSet when new messages are appended (e.g., during streaming).
  // Only adds the newly appended messages (at the end of the messages array).
  // The batch loop handles initial progressive loading; this effect handles streaming.
  useEffect(() => {
    const prevLen = prevMsgCountRef.current;
    prevMsgCountRef.current = messages.length;
    if (messages.length > prevLen) {
      // New messages were appended at the end. Only add the delta.
      const delta = messages.length - prevLen;
      const newMessages = messages.slice(messages.length - delta, messages.length).map((msg, i) => ({
        message: msg,
        index: messages.length - delta + i,
      }));
      setRenderedSet((prev) => [...prev, ...newMessages]);
    }
  }, [messages]);

  useEffect(() => {
    if (!isLoading) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = window.electron.platform === 'darwin';
      const isSearchShortcut = (isMac ? e.metaKey : e.ctrlKey) && e.key === 'f';
      if (isSearchShortcut) {
        setRenderedCount(messages.length);
        setRenderedSet(messages.map((msg, i) => ({ message: msg, index: i })));
        setIsLoading(false);
        if (timeoutRef.current) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, messages.length]);

  // --- P0: Pre-compute everything to avoid O(n^2) scans in GooseMessage ---

  // Global: tool call chains (computed once)
  const toolCallChains = useMemo(() => identifyConsecutiveToolCalls(messages), [messages]);

  // Global: pending confirmation IDs (O(n) once, not O(n) per message)
  const pendingConfirmationIds = useMemo(() => getPendingToolConfirmationIds(messages), [messages]);

  // Global: confirmation index (scan all messages ONCE, not once per tool request per message)
  const confirmationIndex = useMemo(() => {
    const index = new Map<string, ToolConfirmationData>();
    for (const msg of messages) {
      const confirmationData = getAnyToolConfirmationData(msg);
      if (confirmationData) {
        index.set(confirmationData.id, confirmationData);
      }
    }
    return index;
  }, [messages]);

  // Per-message: pre-compute tool requests, response map, and confirmation lookup
  // O(n) total: build response lookup once, then each message's data is O(tools per message)
  const perMessageData = useMemo(() => {
    const data = new Map<string, PerMessagePrecompute>();

    // Build O(n) response lookup: response ID -> response object (single scan of all messages)
    const responseLookup = new Map<string, ReturnType<typeof getToolResponses>[0]>();
    for (const msg of messages) {
      const responses = getToolResponses(msg);
      for (const resp of responses) {
        responseLookup.set(resp.id, resp);
      }
    }

    // Now each message's precompute is O(tools in this message) - O(1) lookup per tool
    for (const message of messages) {
      const toolRequests = getToolRequests(message);
      const toolResponsesMap = new Map<string, ReturnType<typeof getToolResponses>[0]>();

      // Match responses to this message's tool requests using the O(1) lookup
      for (const req of toolRequests) {
        const matching = responseLookup.get(req.id);
        if (matching) {
          toolResponsesMap.set(req.id, matching);
        }
      }

      // Use the shared confirmationIndex Map directly (no closure per message)
      const findConfirmationForTool = (toolRequestId: string) => {
        return confirmationIndex.get(toolRequestId);
      };

      data.set(message.id!, { toolRequests, toolResponsesMap, findConfirmationForTool });
    }

    return data;
  }, [messages, confirmationIndex]);

  // Confirmation IDs already shown inline via findConfirmationForTool on tool request rows.
  // Tracks which confirmations have been rendered inline (regardless of pending status)
  // to prevent the standalone ToolCallConfirmation from appearing after the action is processed.
  const inlineConfirmationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of messages) {
      const mData = perMessageData.get(msg.id!);
      if (!mData) continue;
      for (const req of mData.toolRequests) {
        const confirmation = confirmationIndex.get(req.id);
        if (confirmation) {
          ids.add(confirmation.id);
        }
      }
    }
    return ids;
  }, [messages, perMessageData, confirmationIndex]);

  // --- Render ---

  const renderMessages = useCallback(() => {
    return renderedSet.map(({ message, index }) => {
      if (!message.metadata.userVisible) {
        return null;
      }
      if (renderMessage) {
        return renderMessage(message, index);
      }

      if (!chat) {
        console.warn('ProgressiveMessageList: chat prop is required when not using custom renderMessage');
        return null;
      }

      const notification = getSystemNotification(message);
      if (notification) {
        return (
          <div
            key={`notification-${message.id ?? `msg-${index}-${message.created}`}`}
            className={`relative ${index === 0 ? 'mt-0' : 'mt-4'} assistant`}
            data-testid="message-container"
          >
            {renderSystemNotification(notification)}
          </div>
        );
      }

      const isUser = isUserMessage(message);
      const messageIsInChain = isInChain(index, toolCallChains);
      const mData = perMessageData.get(message.id!);

      // Fallback for messages with no precompute data
      if (!mData) {
        return (
          <div
            key={message.id ?? `msg-${index}-${message.created}`}
            className={`relative ${index === 0 ? 'mt-0' : 'mt-4'} ${isUser ? 'user' : 'assistant'} ${messageIsInChain ? 'in-chain' : ''}`}
            data-testid="message-container"
          >
            {isUser && !hasOnlyToolResponses(message) ? (
              <UserMessage message={message} onMessageUpdate={onMessageUpdate} />
            ) : null}
          </div>
        );
      }

      return (
        <div
          key={message.id ?? `msg-${index}-${message.created}`}
          className={`relative ${index === 0 ? 'mt-0' : 'mt-4'} ${isUser ? 'user' : 'assistant'} ${messageIsInChain ? 'in-chain' : ''}`}
          data-testid="message-container"
        >
          {isUser ? (
            !hasOnlyToolResponses(message) && (
              <UserMessage message={message} onMessageUpdate={onMessageUpdate} />
            )
          ) : (
            <GooseMessage
              sessionId={chat.sessionId}
              message={message}
              messageIndex={index}
              toolCallChains={toolCallChains}
              toolRequests={mData.toolRequests}
              toolResponsesMap={mData.toolResponsesMap}
              findConfirmationForTool={mData.findConfirmationForTool}
              pendingConfirmationIds={pendingConfirmationIds}
              inlineConfirmationIds={inlineConfirmationIds}
              append={append}
              toolCallNotifications={toolCallNotifications}
              isStreaming={
                isStreamingMessage &&
                !isUser &&
                index === messages.length - 1 &&
                message.role === 'assistant'
              }
              submitElicitationResponse={submitElicitationResponse}
            />
          )}
        </div>
      );
    });
  }, [
    renderedSet,
    messages,
    renderMessage,
    isUserMessage,
    chat,
    append,
    toolCallNotifications,
    isStreamingMessage,
    onMessageUpdate,
    toolCallChains,
    perMessageData,
    pendingConfirmationIds,
    submitElicitationResponse,
  ]);

  return (
    <>
      {renderMessages()}

      {/* Loading indicator at the bottom, shown while progressively rendering */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-8">
          <LoadingGoose
            message={intl.formatMessage(i18n.loadingMessages, {
              renderedCount,
              totalCount: messages.length,
            })}
          />
          <div className="text-xs text-text-secondary mt-2">
            {intl.formatMessage(i18n.searchHint)}
          </div>
        </div>
      )}
    </>
  );
}
