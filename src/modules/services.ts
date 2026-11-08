import { AnalysisService } from "./analysis/analysis.service";
import { AuthService } from "./auth/auth.service";
import { BidsService } from "./bids/bids.service";
import { BillingService } from "./billing/billing.service";
import { CalendarService } from "./calendar/calendar.service";
import { DocumentsService } from "./documents/documents.service";
import { ExperiencesService } from "./experiences/experiences.service";
import { NoticesService } from "./notices/notices.service";
import { NotificationsService } from "./notifications/notifications.service";
import { OrganizationsService } from "./organizations/organizations.service";
import { RulesService } from "./rules/rules.service";
import type { Deps } from "./shared/ports";

/** Wires every service on top of the same dependencies. */
export function createServices(deps: Deps) {
  const notifications = new NotificationsService(deps);
  const analysis = new AnalysisService(deps, notifications);
  return {
    auth: new AuthService(deps),
    organizations: new OrganizationsService(deps),
    experiences: new ExperiencesService(deps),
    notices: new NoticesService(deps),
    rules: new RulesService(deps, analysis),
    analysis,
    bids: new BidsService(deps, analysis, notifications),
    documents: new DocumentsService(deps, notifications),
    notifications,
    calendar: new CalendarService(deps),
    billing: new BillingService(deps, notifications),
  };
}

export type Services = ReturnType<typeof createServices>;
