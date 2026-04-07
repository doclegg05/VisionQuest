import type {
  StudentData,
  PublicCredentialPageData,
} from "./types";

interface ProgressTabProps {
  data: StudentData;
  dateFormatter: Intl.DateTimeFormat;
  /** Certification verification callback */
  verifying: string | null;
  onVerify: (requirementId: string, verified: boolean) => void;
  /** Conversations show-all toggle */
  showAllConversations: boolean;
  onShowAllConversations: () => void;
}

export default function ProgressTab({
  data,
  dateFormatter,
  verifying,
  onVerify,
  showAllConversations,
  onShowAllConversations,
}: ProgressTabProps) {
  const {
    orientation,
    certification,
    publicCredentialPage,
    applications,
    eventRegistrations,
    portfolio,
    hasResume,
    files,
    conversations,
  } = data;

  const orientDone = orientation.progress.filter((progressItem) => progressItem.completed).length;
  const orientTotal = orientation.items.length;
  const certDone = certification.cert
    ? certification.cert.requirements.filter((requirement) => requirement.completed).length
    : 0;
  const activeApplications = applications.filter((application) =>
    ["applied", "interviewing", "offer"].includes(application.status)
  );
  const activeEventRegistrations = eventRegistrations.filter(
    (registration) => registration.status === "registered"
  );

  return (
    <div className="space-y-6">
      {/* Orientation */}
      <div id="orientation-review" className="theme-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[var(--ink-strong)] mb-3">
          Orientation ({orientDone}/{orientTotal})
        </h3>
        {orientTotal === 0 ? (
          <p className="text-sm text-[var(--ink-faint)]">No orientation items configured.</p>
        ) : (
          <div className="space-y-1">
            {orientation.items.map((item) => {
              const progressItem = orientation.progress.find((progress) => progress.itemId === item.id);
              return (
                <div key={item.id} className="flex items-center gap-2 text-sm">
                  <span className={progressItem?.completed ? "text-green-500" : "text-[var(--ink-faint)]"}>
                    {progressItem?.completed ? "\u2713" : "\u25CB"}
                  </span>
                  <span className={progressItem?.completed ? "text-[var(--ink-strong)]" : "text-[var(--ink-muted)]"}>
                    {item.label}
                  </span>
                  {item.required && !progressItem?.completed && (
                    <span className="text-xs bg-red-50 text-red-700 px-1.5 py-0.5 rounded">Required</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Certification */}
      <div id="certification-review" className="theme-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[var(--ink-strong)] mb-3">
          Ready to Work Certification ({certDone}/{certification.templates.length})
          {certification.cert?.status === "completed" && (
            <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Completed</span>
          )}
        </h3>
        {!certification.cert ? (
          <p className="text-sm text-[var(--ink-faint)]">Student hasn&apos;t started certification yet.</p>
        ) : (
          <div className="space-y-2">
            {certification.templates.map((template) => {
              const requirement = certification.cert?.requirements.find((item) => item.templateId === template.id);
              return (
                <div key={template.id} className="theme-input rounded-lg p-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className={requirement?.completed ? "text-green-500" : "text-[var(--ink-faint)]"}>
                        {requirement?.completed ? "\u2713" : "\u25CB"}
                      </span>
                      <span className="text-sm text-[var(--ink-strong)]">{template.label}</span>
                      {template.required && (
                        <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Required</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {requirement?.fileId && (
                        <a
                          href={`/api/files/download?id=${requirement.fileId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          {"\uD83D\uDCCE"} View file
                        </a>
                      )}

                      {template.needsVerify && requirement?.completed && (
                        <button
                          onClick={() => onVerify(requirement.id, !requirement.verifiedBy)}
                          disabled={verifying === requirement.id}
                          className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                            requirement.verifiedBy
                              ? "bg-green-100 text-green-700 hover:bg-red-50 hover:text-red-600"
                              : "bg-orange-100 text-orange-700 hover:bg-green-100 hover:text-green-700"
                          }`}
                        >
                          {verifying === requirement.id
                            ? "..."
                            : requirement.verifiedBy
                              ? "\u2713 Verified"
                              : "Verify"}
                        </button>
                      )}
                    </div>
                  </div>

                  {requirement?.verifiedAt && (
                    <p className="text-xs text-[var(--ink-faint)] mt-1 ml-6">
                      Verified {new Date(requirement.verifiedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <PublicCredentialBanner publicCredentialPage={publicCredentialPage} />
      </div>

      {/* Career Progress */}
      <div id="career-progress" className="theme-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[var(--ink-strong)] mb-3">
          Career Progress ({activeApplications.length} active apps {"\u2022"} {activeEventRegistrations.length} event registrations)
        </h3>

        <div className="grid gap-6 xl:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-faint)]">Applications</p>
            {applications.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--ink-faint)]">No tracked applications yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {applications.slice(0, 6).map((application) => (
                  <div key={application.id} className="theme-card-subtle rounded-lg p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold text-[var(--ink-strong)]">{application.opportunity.title}</p>
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">
                          {application.opportunity.company} {"\u2022"} {application.opportunity.type}
                        </p>
                      </div>
                      <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">
                        {application.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[var(--ink-faint)]">
                      Updated {dateFormatter.format(new Date(application.updatedAt))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-faint)]">Event engagement</p>
            {eventRegistrations.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--ink-faint)]">No event registrations yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {eventRegistrations.slice(0, 6).map((registration) => (
                  <div key={registration.id} className="theme-card-subtle rounded-lg p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold text-[var(--ink-strong)]">{registration.event.title}</p>
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">
                          {dateFormatter.format(new Date(registration.event.startsAt))}
                        </p>
                      </div>
                      <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-teal-700">
                        {registration.status}
                      </span>
                    </div>
                    {registration.event.location ? (
                      <p className="mt-2 text-xs text-[var(--ink-faint)]">{registration.event.location}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Portfolio */}
      <div className="theme-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[var(--ink-strong)] mb-3">
          Portfolio ({portfolio.length} items)
          {hasResume && <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Resume built</span>}
        </h3>
        {portfolio.length === 0 ? (
          <p className="text-sm text-[var(--ink-faint)]">No portfolio items yet.</p>
        ) : (
          <div className="space-y-1">
            {portfolio.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-[var(--ink-faint)] capitalize bg-[var(--surface-interactive)] px-1.5 py-0.5 rounded">
                  {item.type}
                </span>
                <span className="text-[var(--ink-strong)]">{item.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Files */}
      <div className="theme-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[var(--ink-strong)] mb-3">Files ({files.length})</h3>
        {files.length === 0 ? (
          <p className="text-sm text-[var(--ink-faint)]">No files uploaded.</p>
        ) : (
          <div className="space-y-1">
            {files.map((file) => (
              <div key={file.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--ink-faint)] capitalize bg-[var(--surface-interactive)] px-1.5 py-0.5 rounded">
                    {file.category}
                  </span>
                  <a
                    href={`/api/files/download?id=${file.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800"
                  >
                    {file.filename}
                  </a>
                </div>
                <span className="text-xs text-[var(--ink-faint)]">
                  {new Date(file.uploadedAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Conversations */}
      <div className="theme-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[var(--ink-strong)] mb-3">
          Conversations ({conversations.length})
        </h3>
        {conversations.length === 0 ? (
          <p className="text-sm text-[var(--ink-faint)]">No conversations yet.</p>
        ) : (
          <div className="space-y-2">
            {(showAllConversations ? conversations : conversations.slice(0, 20)).map((conv) => (
              <div key={conv.id} className="surface-section p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{conv.module === "goal" ? "\uD83C\uDFAF" : "\uD83D\uDCAC"}</span>
                      <p className="text-sm font-semibold text-[var(--ink-strong)]">
                        {conv.title || `${conv.stage} conversation`}
                      </p>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <span className="rounded-full bg-[rgba(15,154,146,0.1)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-secondary)]">
                        {conv.stage}
                      </span>
                      <span className="text-xs text-[var(--ink-muted)]">
                        {conv.messageCount} messages ({conv.userMessageCount} from student)
                      </span>
                    </div>
                    {conv.lastMessagePreview && (
                      <p className="mt-2 text-xs text-[var(--ink-muted)] line-clamp-2">&ldquo;{conv.lastMessagePreview}&rdquo;</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-[var(--ink-muted)]">
                    {new Date(conv.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
            {!showAllConversations && conversations.length > 20 && (
              <button
                onClick={onShowAllConversations}
                className="w-full text-xs text-[var(--accent-strong)] hover:text-[var(--ink-strong)] py-2"
              >
                Show all {conversations.length} conversations
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PublicCredentialBanner({
  publicCredentialPage,
}: {
  publicCredentialPage: PublicCredentialPageData | null;
}) {
  return (
    <div className="mt-4 rounded-lg border border-[rgba(15,154,146,0.14)] bg-[rgba(15,154,146,0.07)] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-secondary)]">
        Public credential
      </p>
      <p className="mt-2 text-sm text-[var(--ink-strong)]">
        {publicCredentialPage?.isPublic
          ? "This student's credential page is live and shareable."
          : "No public credential page is live yet."}
      </p>
      {publicCredentialPage?.isPublic ? (
        <a
          href={`/credentials/${publicCredentialPage.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex text-sm font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
        >
          Open public credential {"\u2192"}
        </a>
      ) : null}
    </div>
  );
}
