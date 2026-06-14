/**
 * Phase 2A–3D type aliases derived from the contract's generated `components`.
 * These shapes live in @docmee/contracts (openapi.yaml) — FE never hand-writes them.
 * Once BE adds named aliases to @docmee/contracts' index, import from there instead.
 */
import type { components } from "@docmee/contracts";

type S = components["schemas"];

// 2A
export type Clinic = S["Clinic"];
export type ClinicPage = S["ClinicPage"];
export type UserCreate = S["UserCreate"];
export type UserPage = S["UserPage"];
export type QuickReply = S["QuickReply"];
export type QuickReplyCreate = S["QuickReplyCreate"];
export type QuickReplyPage = S["QuickReplyPage"];

// 2B
export type ChannelConnection = S["ChannelConnection"];
export type ChannelConnectionPage = S["ChannelConnectionPage"];

// 2C
export type Template = S["Template"];
export type TemplateCreate = S["TemplateCreate"];
export type TemplatePage = S["TemplatePage"];
export type AutomationSettings = S["AutomationSettings"];

// 2D
export type AnalyticsOverview = S["AnalyticsOverview"];

// 3A
export type Doctor = S["Doctor"];
export type DoctorCreate = S["DoctorCreate"];
export type DoctorPage = S["DoctorPage"];

// 3B
export type Flow = S["Flow"];
export type FlowCreate = S["FlowCreate"];
export type FlowPage = S["FlowPage"];
export type CopilotSuggestion = S["CopilotSuggestion"];

// 3C
export type DocumentEntry = S["Document"];
export type DocumentCreate = S["DocumentCreate"];
export type DocumentPage = S["DocumentPage"];
export type ExportJob = S["ExportJob"];
export type ExportJobCreate = S["ExportJobCreate"];
export type ExportJobPage = S["ExportJobPage"];

// 3D
export type PushSubscriptionCreate = S["PushSubscriptionCreate"];
export type PushSubscriptionAck = S["PushSubscriptionAck"];
