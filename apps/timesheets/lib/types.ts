export type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  active: boolean;
};

export type ProjectItem = {
  project_item: string; // e.g. "10160-01"
  line_desc: string;
  completed?: boolean;
};

export type TimesheetEntry = {
  id?: string;
  employee_id: string;
  project_item: string;
  work_date: string; // YYYY-MM-DD
  hours: number;
  entered_by?: string;
};

/** A row in the weekly grid: one project item across 7 days */
export type GridRow = {
  project_item: string;
  line_desc?: string;
  /** hours indexed by ISO date string (YYYY-MM-DD) */
  hours: Record<string, number>;
  /** overtime flags indexed by ISO date string */
  overtime: Record<string, boolean>;
};
