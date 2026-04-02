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
      <div id="orientation-review" className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Orientation ({orientDone}/{orientTotal})
        </h3>
        {orientTotal === 0 ? (
          <p className="text-sm text-gray-400">No orientation items configured.</p>
        ) : (
          <div className="space-y-1">
            {orientation.items.map((item) => {
              const progressItem = orientation.progress.find((progress) => progress.itemId === item.id);
              return (
                <div key={item.id} className="flex items-center gap-2 text-sm">
                  <span className={progressItem?.completed ? "text-green-500" : "text-gray-300"}>
                    {progressItem?.completed ? "\u2713" : "\u25CB"}
                  </span>
                  <span className={progressItem?.completed ? "text-gray-700" : "text-gray-500"}>
                    {item.label}
                  </span>
                  {item.required && !progressItem?.completed && (
                    <span className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">Required</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Certification */}
      <div id="certification-review" className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Ready to Work Certification ({certDone}/{certification.templates.length})
          {certification.cert?.status === "completed" && (
            <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Completed</span>
          )}
        </h3>
        {!certification.cert ? (
          <p className="text-sm text-gray-400">Student hasn&apos;t started certification yet.</p>
        ) : (
          <div className="space-y-2">
            {certification.templates.map((template) => {
              const requirement = certification.cert?.requirements.find((item) => item.templateId === template.id);
              return (
                <div key={template.id} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className={requirement?.completed ? "text-green-500" : "text-gray-300"}>
                        {requirement?.completed ? "\u2713" : "\u25CB"}
                      </span>
                      <span className="text-sm text-gray-700">{template.label}</span>
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
                    <p className="text-xs text-gray-400 mt-1 ml-6">
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
      <div id="career-progress" className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Career Progress ({activeApplications.length} active apps {"\u2022"} {activeEventRegistrations.length} event registrations)
        </h3>

        <div className="grid gap-6 xl:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-400">Applications</p>
            {applications.length === 0 ? (
              <p className="mt-3 text-sm text-gray-400">No tracked applications yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {applications.slice(0, 6).map((application) => (
                  <div key={application.id} className="rounded-lg border border-gray-100 p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{application.opportunity.title}</p>
                        <p className="mt-1 text-sm text-gray-500">
                          {application.opportunity.company} {"\u2022"} {application.opportunity.type}
                        </p>
                      </div>
                      <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                        {application.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">
                      Updated {dateFormatter.format(new Date(application.updatedAt))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-400">Event engagement</p>
            {eventRegistrations.length === 0 ? (
              <p className="mt-3 text-sm text-gray-400">No event registrations yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {eventRegistrations.slice(0, 6).map((registration) => (
                  <div key={registration.id} className="rounded-lg border border-gray-100 p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{registration.event.title}</p>
                        <p className="mt-1 text-sm text-gray-500">
                          {dateFormatter.format(new Date(registration.event.startsAt))}
                        </p>
                      </div>
                      <span className="rounded-full bg-teal-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-700">
                        {registration.status}
                      </span>
                    </div>
                    {registration.event.location ? (
                      <p className="mt-2 text-xs text-gray-400">{registration.event.location}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Portfolio */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Portfolio ({portfolio.length} items)
          {hasResume && <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Resume built</span>}
        </h3>
        {portfolio.length === 0 ? (
          <p className="text-sm text-gray-400">No portfolio items yet.</p>
        ) : (
          <div className="space-y-1">
            {portfolio.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-gray-400 capitalize bg-gray-100 px-1.5 py-0.5 rounded">
                  {item.type}
                </span>
                <span className="text-gray-700">{item.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Files */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Files ({files.length})</h3>
        {files.length === 0 ? (
          <p className="text-sm text-gray-400">No files uploaded.</p>
        ) : (
          <div className="space-y-1">
            {files.map((file) => (
              <div key={file.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 capitalize bg-gray-100 px-1.5 py-0.5 rounded">
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
                <span className="text-xs text-gray-400">
                  {new Date(file.uploadedAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Conversations */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Conversations ({conversations.length})
        </h3>
        {conversations.length === 0 ? (
          <p className="text-sm text-gray-400">No conversations yet.</p>
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
                      <span className="rounded-full bg-[rgba(15,154,146,0.1)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-secondary)]">
                        {conv.stage}
                      </span>
                      <span className="text-[10px] text-[var(--ink-muted)]">
                        {conv.messageCount} messages ({conv.userMessageCount} from student)
                      </span>
                    </div>
                    {conv.lastMessagePreview && (
                      <p className="mt-2 text-xs text-[var(--ink-muted)] line-clamp-2">&ldquo;{conv.lastMessagePreview}&rdquo;</p>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">
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
      <p className="mt-2 text-sm text-gray-700">
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
