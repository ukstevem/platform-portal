export type UserInfo = {
  id: string;
  email: string | null;
  fullName: string | null;
  /** Optional friendly/known-as name ("Steve" for "Stephen"). Null unless set by hand. */
  preferredName: string | null;
};

export type ProjectRole = "none" | "member" | "manager" | "admin";
