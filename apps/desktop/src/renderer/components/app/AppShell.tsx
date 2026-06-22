import { clsx } from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { Loader2, LogIn, Download } from 'lucide-react';
import { type FileFetcher } from '../file-viewer';
import { WorkspaceShell } from '../workspace';
import { ChatHeaderMenu } from '../chat/modes/window/parts/ChatHeaderMenu';
import CommandPalette from '../CommandPalette';
import HotkeysHelp from '../HotkeysHelp';
import { PermissionDialog } from '../PermissionDialog';
import { WorkflowOverlay } from '../WorkflowOverlay/WorkflowOverlay';
import { NotificationProvider, NotificationController } from '../NotificationSystem';
import { InteractiveTour } from '../onboarding/InteractiveTour';
import { OnboardingTooltipContainer } from '../onboarding';
import { AskUserPrompt } from '@stuardai/chat-ui/AskUserPrompt';
import { ExitProjectToast } from '../chat/modes/window/parts/ActiveProjectBar';
import { ChatView } from '../chat/modes/window/ChatView';
import { LauncherView } from '../chat/modes/launcher/LauncherView';
import InputArea from '../chat/shared/input/InputArea';

function dismissApprovalNotification(id: string) {
  try {
    (window as any).desktopAPI?.dismissNotification?.(id);
  } catch { }
}

export function AppShell(props: any) {
  const {
    subscribeProgress,
    exitedProject,
    handleUndoExit,
    setExitedProject,
    overlayVisible,
    showResizeGrips,
    overlayMode,
    approvalQueue,
    respondToApproval,
    setApprovalQueue,
    askUserPrompt,
    setAskUserPrompt,
    lastError,
    showCreditsLimitNotice,
    onDismissCreditsLimitNotice,
    onAddCredits,
    handleSignIn,
    hasMessages,
    messages,
    currentResponse,
    currentReasoning,
    currentToolCalls,
    currentStreamChunks,
    thinkingStartTime,
    contextPaths,
    setContextPaths,
    handleRemoveContext,
    handleShowCompact,
    handleOpenDashboard,
    handleNewChat,
    handleToggleVoice,
    voice,
    chatMenuOpen,
    setChatMenuOpen,
    convList,
    loadingConvs,
    handleSelectConversation,
    chatStatusText,
    ai,
    connectionStatus,
    chatMode,
    handleChatModeChange,
    chatModels,
    handleChatModelsChange,
    modelSource,
    setModelSource,
    reasoningLevel,
    setReasoningLevel,
    tabs,
    activeTabId,
    switchTab,
    closeTab,
    addTab,
    translucentMode,
    submitToolOutput,
    handleGenUIResponse,
    handleEditMessage,
    revertFiles,
    redoFiles,
    pendingMemories,
    confirmPendingMemory,
    rejectPendingMemory,
    handleAddContext,
    attachments,
    handleRemoveAttachment,
    handleAttachFiles,
    handleAttachImages,
    handleDrop,
    queueDepth,
    queuedMessages,
    cancelQueuedMessage,
    query,
    setQuery,
    handleSend,
    handleQuickSend,
    handleScreenshotSend,
    handleSteer,
    stopGeneration,
    isStreaming,
    activeSubagentsForTab,
    steerTarget,
    setSteerTarget,
    internalSidebarOpen,
    internalSidebarWidth,
    activeSidebarTab,
    handleToggleInternalSidebar,
    handleCloseInternalSidebar,
    handleSwitchSidebarTab,
    handleInternalSidebarResize,
    activeProject,
    conversationId,
    handleExitProjectMode,
    handleOpenProjectHome,
    inputRef,
    handlePaste,
    signedIn,
    conversationTitle,
    inputStatusText,
    inputStatusIcon,
    inputStatusPresentation,
    inputStatusActivityState,
    statusDiscoveryTip,
    statusDiscoveryVisible,
    handleStatusDiscoveryAction,
    inputStatusUrgency,
    inputStatusMinutesUntil,
    inputStatusItems,
    isRecording,
    handleMicClick,
    accessToken,
    plannerData,
    commands,
    showPalette,
    handleClosePalette,
    setPaletteQuery,
    isMarketplaceSearching,
    showHotkeys,
    handleCloseHotkeys,
    showTour,
    setTourComplete,
    handleShowWindow,
    handleShowApp,
    updateState,
    miniOutputText,
    miniOutputHasContent,
    miniOutputStreaming,
    miniOutputPrompt,
    miniOutputUserAttachments,
    showMiniOutput,
    setShowMiniOutput,
    backgroundTaskCount,
    compactHubTabs,
  } = props;

  // Track maximized state so we can drop the floating padding/rounding when
  // the user maximizes the window — otherwise "maximize" still shows the
  // floating card with a gap to the screen edges.
  const [overlayMaximized, setOverlayMaximized] = useState(false);
  useEffect(() => {
    if (overlayMode !== 'window' && overlayMode !== 'app') {
      setOverlayMaximized(false);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const isMax = await (window as any).desktopAPI?.overlayIsMaximized?.();
        if (!cancelled) setOverlayMaximized(!!isMax);
      } catch { /* ignore */ }
    };
    void refresh();
    const unsub = (window as any).desktopAPI?.onOverlayMaximizedChanged?.(({ maximized }: { maximized: boolean }) => {
      setOverlayMaximized(!!maximized);
    });
    return () => {
      cancelled = true;
      try { unsub?.(); } catch { /* ignore */ }
    };
  }, [overlayMode]);

  const isFloatingWindow = overlayMode === 'window';
  const isAppWindow = isFloatingWindow || overlayMode === 'app';
  const isMaximizedWindow = isAppWindow && overlayMaximized;

  // Local file fetcher for the Workspace preview pane — reads bytes/text on
  // demand from the main process. Only used while the FileViewerProvider is
  // mounted (app mode).
  const localFileFetcher = useMemo<FileFetcher>(
    () => async (path: string) => {
      try {
        const res = await (window as any).desktopAPI?.previewReadFile?.(path);
        if (!res || res.error || res.content == null) return null;
        return { content: res.content, encoding: res.encoding || 'utf-8', size: res.size || 0 };
      } catch {
        return null;
      }
    },
    [],
  );

  const mainPanelView = hasMessages ? (
    <ChatView
      messages={messages}
      currentResponse={currentResponse}
      currentReasoning={currentReasoning}
      currentToolCalls={currentToolCalls}
      currentStreamChunks={currentStreamChunks}
      thinkingStartTime={thinkingStartTime}
      contextPaths={contextPaths}
      onRemoveContext={handleRemoveContext}
      onCollapse={handleShowCompact}
      onOpenDashboard={handleOpenDashboard}
      onNewChat={handleNewChat}
      voiceActive={false}
      onToggleVoice={handleToggleVoice}
      voiceState={voice.state}
      voiceAudioLevel={voice.audioLevel}
      voiceMuted={voice.muted}
      onVoiceMuteToggle={voice.toggleMute}
      voiceTranscripts={voice.transcripts}
      voiceActiveTools={voice.activeTools}
      chatMenuOpen={chatMenuOpen}
      onChatMenuOpenChange={setChatMenuOpen}
      conversations={convList}
      loadingConversations={loadingConvs}
      onSelectConversation={handleSelectConversation}
      statusText={chatStatusText}
      statusPresentation={inputStatusPresentation}
      statusActivityState={inputStatusActivityState}
      statusDiscoveryTip={statusDiscoveryTip}
      statusDiscoveryVisible={statusDiscoveryVisible}
      onStatusDiscoveryAction={handleStatusDiscoveryAction}
      connectionStatus={connectionStatus}
      chatMode={chatMode}
      onChatModeChange={handleChatModeChange as any}
      chatModels={chatModels}
      onChatModelsChange={handleChatModelsChange as any}
      modelSource={modelSource}
      onModelSourceChange={setModelSource}
      reasoningLevel={reasoningLevel}
      onReasoningLevelChange={setReasoningLevel}
      overlayMode={overlayMode}
      tabs={tabs}
      activeTabId={activeTabId}
      onSwitchTab={switchTab}
      onCloseTab={closeTab}
      onAddTab={addTab}
      translucentMode={translucentMode}
      onSubmitToolOutput={submitToolOutput}
      onGenUIResponse={handleGenUIResponse}
      onEditMessage={handleEditMessage}
      onRevertFiles={revertFiles}
      onRedoFiles={redoFiles}
      pendingMemories={pendingMemories}
      onConfirmPendingMemory={confirmPendingMemory}
      onRejectPendingMemory={rejectPendingMemory}
      onAddContext={handleAddContext}
      attachments={attachments}
      onRemoveAttachment={handleRemoveAttachment}
      onAttachFiles={handleAttachFiles}
      onAttachImages={handleAttachImages}
      onDrop={handleDrop}
      queueDepth={queueDepth}
      queuedMessages={queuedMessages}
      onCancelQueuedMessage={cancelQueuedMessage}
      query={query}
      setQuery={setQuery}
      onSend={handleSend}
      onSteer={handleSteer}
      onStop={stopGeneration}
      isStreaming={isStreaming}
      activeSubagents={activeSubagentsForTab}
      steerTarget={steerTarget}
      onSteerTargetChange={setSteerTarget}
      internalSidebarOpen={internalSidebarOpen}
      internalSidebarWidth={internalSidebarWidth}
      activeSidebarTab={activeSidebarTab}
      onToggleInternalSidebar={handleToggleInternalSidebar}
      onCloseInternalSidebar={handleCloseInternalSidebar}
      onSwitchSidebarTab={handleSwitchSidebarTab}
      onInternalSidebarResize={handleInternalSidebarResize}
      activeProject={activeProject}
      activeConversationId={conversationId}
      onExitProjectMode={handleExitProjectMode}
      onOpenProjectHome={handleOpenProjectHome}
      showCreditsLimitNotice={showCreditsLimitNotice}
      onDismissCreditsLimitNotice={onDismissCreditsLimitNotice}
      onAddCredits={onAddCredits}
      askUserPrompts={askUserPrompt ? [{ id: askUserPrompt.id, tool: 'ask_user', args: askUserPrompt.args, status: 'pending' }] : []}
      onAskUserRespond={(id, result) => {
        (window as any).desktopAPI?.respondToAskUser?.(id, result);
        setAskUserPrompt(null);
      }}
    />
  ) : (
    <LauncherView
      query={query}
      setQuery={setQuery}
      onSend={handleSend}
      contextPaths={contextPaths}
      onAddContext={handleAddContext}
      onRemoveContext={handleRemoveContext}
      attachments={attachments}
      onAttachFiles={handleAttachFiles}
      onAttachImages={handleAttachImages}
      onRemoveAttachment={handleRemoveAttachment}
      onPaste={handlePaste}
      onDrop={handleDrop}
      commands={commands}
      statusText={inputStatusText}
      statusPresentation={inputStatusPresentation}
      statusDiscoveryTip={statusDiscoveryTip}
      statusDiscoveryVisible={statusDiscoveryVisible}
      onStatusDiscoveryAction={handleStatusDiscoveryAction}
      connectionStatus={connectionStatus}
      onMicClick={handleMicClick}
      isRecording={isRecording}
      accessToken={accessToken}
      overlayMode={overlayMode}
      tabs={tabs}
      activeTabId={activeTabId}
      onSwitchTab={switchTab}
      onCloseTab={closeTab}
      onAddTab={addTab}
      onCollapse={handleShowCompact}
      voiceActive={false}
      onToggleVoice={handleToggleVoice}
      voiceState={voice.state}
      voiceAudioLevel={voice.audioLevel}
      voiceMuted={voice.muted}
      onVoiceMuteToggle={voice.toggleMute}
      voiceTranscripts={voice.transcripts}
      voiceActiveTool={voice.activeTool}
      voiceActiveTools={voice.activeTools}
      voiceLastTool={voice.lastTool}
      chatMenuOpen={chatMenuOpen}
      onChatMenuOpenChange={setChatMenuOpen}
      onNewChat={handleNewChat}
      conversations={convList}
      loadingConversations={loadingConvs}
      activeConversationId={conversationId}
      onSelectConversation={handleSelectConversation}
      onOpenDashboard={handleOpenDashboard}
      onToggleExpand={handleShowWindow}
      onToggleSidebar={handleToggleInternalSidebar}
      sidebarOpen={internalSidebarOpen}
      plannerData={plannerData}
      translucentMode={translucentMode}
      chatMode={chatMode}
      onChatModeChange={handleChatModeChange as any}
      chatModels={chatModels}
      onChatModelsChange={handleChatModelsChange as any}
      modelSource={modelSource}
      onModelSourceChange={setModelSource}
      reasoningLevel={reasoningLevel}
      onReasoningLevelChange={setReasoningLevel}
      activeSidebarTab={activeSidebarTab}
      internalSidebarWidth={internalSidebarWidth}
      onCloseInternalSidebar={handleCloseInternalSidebar}
      onSwitchSidebarTab={handleSwitchSidebarTab}
      onInternalSidebarResize={handleInternalSidebarResize}
      showCreditsLimitNotice={showCreditsLimitNotice}
      onDismissCreditsLimitNotice={onDismissCreditsLimitNotice}
      onAddCredits={onAddCredits}
    />
  );

  const workspaceToolbar = (
    <ChatHeaderMenu
      onToggleSidebar={handleToggleInternalSidebar}
      sidebarOpen={internalSidebarOpen}
      onOpenDashboard={handleOpenDashboard}
      onCollapse={handleShowCompact}
      overlayMode="app"
      chatMenuOpen={chatMenuOpen}
      onChatMenuOpenChange={setChatMenuOpen}
      conversations={convList}
      loadingConversations={loadingConvs}
      activeConversationId={conversationId}
      onSelectConversation={handleSelectConversation}
      onNewChat={handleNewChat}
    />
  );

  return (
    <NotificationProvider>
      <NotificationController subscribeProgress={subscribeProgress} />
      {exitedProject && (
        <ExitProjectToast
          project={exitedProject}
          onUndo={handleUndoExit}
          onDismiss={() => setExitedProject(null)}
        />
      )}
      <div className={`overlay-window-shell ${overlayVisible ? 'overlay-window-shell-visible' : 'overlay-window-shell-hidden'} w-full h-full text-sans overflow-hidden relative`}>
        {/* Resize handles for user-resizable window - invisible but draggable edges */}
        {showResizeGrips && (
          <>
            {isAppWindow ? (
              <>
                {/* Window/app mode: corner grips only so edge strips do not block the input bar */}
                <div className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize z-[50]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                <div className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize z-[50]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                <div className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize z-[50]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                <div className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-[50]" style={{ WebkitAppRegion: 'no-drag' } as any} />
              </>
            ) : (
              <>
                <div className="absolute top-0 left-2 right-2 h-1 cursor-ns-resize z-[50]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                <div className="absolute bottom-0 left-2 right-2 h-1 cursor-ns-resize z-[50]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                <div className="absolute top-2 bottom-2 left-0 w-1 cursor-ew-resize z-[50]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                <div className="absolute top-2 bottom-2 right-0 w-1 cursor-ew-resize z-[50]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                <div className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize z-[51]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                <div className="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize z-[51]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                <div className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize z-[51]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                <div className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize z-[51]" style={{ WebkitAppRegion: 'no-drag' } as any} />
              </>
            )}
          </>
        )}
        <div className="w-full h-full overflow-hidden bg-transparent flex flex-col">
          {overlayMode === 'app' ? (
            <div
              className={clsx(
                'relative h-full w-full overflow-hidden mode-transition overlay-responsive flex flex-col min-h-0',
                // Fill the window edge-to-edge like a real desktop app — no inset
                // margin. The shell keeps a slight corner rounding (flattened when
                // maximized via data-overlay-maximized).
                'p-0',
              )}
              data-overlay-maximized={isMaximizedWindow ? 'true' : 'false'}
            >
              {showResizeGrips && (
                <>
                  <div className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize z-[50]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                  <div className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize z-[50]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                  <div className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize z-[50]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                  <div className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-[50]" style={{ WebkitAppRegion: 'no-drag' } as any} />
                </>
              )}
              {!isMaximizedWindow && showResizeGrips && (
                <div className="resize-indicator" title="Drag corner to resize" />
              )}
              <WorkspaceShell
                onClose={handleShowCompact}
                localFileFetcher={localFileFetcher}
                tabs={tabs}
                activeTabId={activeTabId}
                onSwitchTab={switchTab}
                onCloseTab={closeTab}
                onAddTab={addTab}
                onNewChat={handleNewChat}
                conversations={convList}
                loadingConversations={loadingConvs}
                activeConversationId={conversationId}
                onSelectConversation={handleSelectConversation}
                onAddContext={handleAddContext}
                contextPaths={contextPaths}
                accessToken={accessToken}
                toolbar={workspaceToolbar}
              >
                {mainPanelView}
              </WorkspaceShell>
            </div>
          ) : overlayMode === 'sidebar' || overlayMode === 'window' ? (
            <div
              className={clsx(
                'relative h-full w-full overflow-hidden mode-transition overlay-responsive flex flex-col min-h-0',
                isMaximizedWindow ? 'p-0' : isFloatingWindow ? 'p-5' : 'p-4',
              )}
              data-overlay-maximized={isMaximizedWindow ? 'true' : 'false'}
            >
              {showResizeGrips && (
                <div className="resize-indicator" title="Drag corner to resize" />
              )}
              {/* Main Content - Full Width (above resize grips; interactive, not drag region) */}
              <div
                className="flex flex-1 min-h-0 w-full relative smooth-resize z-[60] flex-col"
                style={{ WebkitAppRegion: 'no-drag' } as any}
              >
                {/* Permission Approval Overlay â€” shows the first queued approval; next auto-appears on dismiss */}
                {approvalQueue.length > 0 && (() => {
                  const ap = approvalQueue[0];
                  return (
                    <PermissionDialog
                      key={ap.id}
                      isOpen
                      tool={ap.tool}
                      args={ap.args}
                      description={approvalQueue.length > 1 ? `${ap.description || ''} (${approvalQueue.length} pending)`.trim() : ap.description}
                      onAllow={() => {
                        dismissApprovalNotification(ap.id);
                        respondToApproval(ap.id, true);
                        setApprovalQueue((q: any[]) => q.filter((p: any) => p.id !== ap.id));
                      }}
                      onDeny={() => {
                        dismissApprovalNotification(ap.id);
                        respondToApproval(ap.id, false);
                        setApprovalQueue((q: any[]) => q.filter((p: any) => p.id !== ap.id));
                      }}
                    />
                  );
                })()}

                {/* In-app Ask User Prompt — launcher fallback (ChatView handles it when hasMessages) */}
                {askUserPrompt && !hasMessages && (
                  <div className="absolute inset-x-0 bottom-16 z-[70] px-2 pointer-events-auto">
                    <AskUserPrompt
                      prompt={askUserPrompt}
                      onRespond={(id, result) => {
                        (window as any).desktopAPI?.respondToAskUser?.(id, result);
                        setAskUserPrompt(null);
                      }}
                    />
                  </div>
                )}

                {/* Session Expired Notification */}
                {(lastError?.code === 'session_expired' || lastError?.data?.requiresSignIn) && (
                  <div className="absolute left-4 right-4 bottom-4 z-50 animate-in slide-in-from-bottom-2 duration-300">
                    <div className="rounded-lg border border-amber-500/30 bg-black/90 backdrop-blur-md p-4">
                      <h3 className="text-amber-400 font-semibold text-sm">Session Expired</h3>
                      <p className="text-white/70 text-xs mt-1 mb-3">Your session has expired. Please sign in again to continue.</p>
                      <button onClick={handleSignIn} className="w-full py-1.5 bg-amber-500 hover:bg-amber-400 rounded text-xs text-black font-bold flex items-center justify-center gap-2">
                        <LogIn className="w-3 h-3" />
                        Sign In
                      </button>
                    </div>
                  </div>
                )}

                {/* Session Refreshed Notification */}
                {lastError?.code === 'session_refreshed' && (
                  <div className="absolute left-4 right-4 bottom-4 z-50 animate-in slide-in-from-bottom-2 duration-300">
                    <div className="rounded-lg border border-emerald-500/30 bg-black/90 backdrop-blur-md p-4">
                      <h3 className="text-emerald-400 font-semibold text-sm">Session Refreshed</h3>
                      <p className="text-white/70 text-xs mt-1">Your session was refreshed. Please try your request again.</p>
                    </div>
                  </div>
                )}

                {mainPanelView}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col relative">
              <InputArea
                ref={inputRef}
                query={query}
                setQuery={setQuery}
                onSend={handleSend}
                onQuickSend={handleQuickSend}
                onScreenshotSend={handleScreenshotSend}
                onSteer={handleSteer}
                attachments={attachments}
                onRemoveAttachment={handleRemoveAttachment}
                onAttachFiles={handleAttachFiles}
                onAttachImages={handleAttachImages}
                onPaste={handlePaste}
                onDrop={handleDrop}
                signedIn={signedIn}
                onSignIn={handleSignIn}
                conversationTitle={conversationTitle}
                conversations={convList}
                loadingConversations={loadingConvs}
                activeConversationId={conversationId}
                onSelectConversation={handleSelectConversation}
                onNewChat={handleNewChat}
                onStopGeneration={stopGeneration}
                onChatMenuOpenChange={setChatMenuOpen}
                chatMenuOpen={chatMenuOpen}
                expanded={false}
                onToggleExpand={handleShowWindow}
                onOpenDashboard={handleOpenDashboard}
                overlayMode={overlayMode}
                statusText={inputStatusText}
                statusIcon={inputStatusIcon}
                statusUrgency={inputStatusUrgency}
                statusMinutesUntil={inputStatusMinutesUntil}
                statusItems={inputStatusItems}
                isAiWorking={isStreaming}
                connectionStatus={connectionStatus}
                queueDepth={queueDepth}
                queuedMessages={queuedMessages}
                onCancelQueuedMessage={cancelQueuedMessage}
                isRecording={isRecording}
                onMicClick={handleMicClick}
                voiceActive={false}
                onToggleVoice={handleToggleVoice}
                voiceState={voice.state}
                voiceAudioLevel={voice.audioLevel}
                voiceMuted={voice.muted}
                onVoiceMuteToggle={voice.toggleMute}
                voiceTranscripts={voice.transcripts}
                voiceActiveTool={voice.activeTool}
                voiceActiveTools={voice.activeTools}
                voiceLastTool={voice.lastTool}
                contextPaths={contextPaths}
                setContextPaths={setContextPaths}
                translucentMode={translucentMode}
                accessToken={accessToken}
                miniOutputText={miniOutputText}
                miniOutputHasContent={miniOutputHasContent}
                miniOutputStreaming={miniOutputStreaming}
                miniOutputPrompt={miniOutputPrompt}
                miniOutputUserAttachments={miniOutputUserAttachments}
                showMiniOutput={showMiniOutput}
                setShowMiniOutput={setShowMiniOutput}
                backgroundTaskCount={backgroundTaskCount}
                compactHubTabs={compactHubTabs}
                currentToolCalls={currentToolCalls}
                currentReasoning={currentReasoning}
                onSubmitToolOutput={submitToolOutput}
                onGenUIResponse={handleGenUIResponse}
              />
            </div>
          )}

          <CommandPalette
            open={showPalette}
            onClose={handleClosePalette}
            commands={commands}
            onQueryChange={setPaletteQuery}
            loading={isMarketplaceSearching}
          />
          <HotkeysHelp open={showHotkeys} onClose={handleCloseHotkeys} />

          {/* Interactive tour — floats hints over the real UI and listens
              for the user to actually do each action. */}
          {showTour && (
            <InteractiveTour
              onMount={() => {
                if (overlayMode !== 'sidebar' && overlayMode !== 'window') {
                  handleShowWindow();
                }
              }}
              onComplete={() => setTourComplete(true)}
            />
          )}
        </div>

        {/* Stuard Workflow Overlay - renders native UI panels from automations */}
        <WorkflowOverlay />

        {/* Onboarding Tooltips */}
        <OnboardingTooltipContainer />

        {/* Full-screen overlay shown while the installer is taking over */}
        {updateState?.status === 'installing' && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in duration-200" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <div className="bg-theme-card border border-theme rounded-2xl shadow-2xl px-8 py-7 max-w-sm mx-4 text-center animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-center mb-4">
                <div className="relative">
                  <Download className="w-10 h-10 text-primary" />
                  <Loader2
                    className="w-14 h-14 animate-spin absolute -top-2 -left-2"
                    style={{ color: 'color-mix(in srgb, var(--primary) 40%, transparent)' }}
                  />
                </div>
              </div>
              <div className="text-base font-bold text-theme-fg tracking-tight font-stuard mb-1.5">Updating Stuard AI</div>
              <div className="text-[12px] text-theme-muted font-medium leading-relaxed">
                The app will close and the installer will take over. It'll relaunch automatically when the update is done.
              </div>
            </div>
          </div>
        )}
      </div>
    </NotificationProvider>
  );
}
