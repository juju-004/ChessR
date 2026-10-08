import { apiFetch } from "./http.js";

export type OrganizationStatus = "pending" | "approved" | "rejected";

export interface MyOrganization {
  id: string;
  name: string;
  whatsapp: string;
  status: OrganizationStatus;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export function getMyOrganization() {
  return apiFetch<{ organization: MyOrganization | null }>("/organizations/mine");
}

export function requestOrganization(input: { name: string; whatsapp: string }) {
  return apiFetch<{ organization: MyOrganization }>("/organizations/request", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
