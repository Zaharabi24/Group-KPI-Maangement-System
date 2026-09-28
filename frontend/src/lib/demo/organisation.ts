/**
 * Organisation master data for the in-browser demo dataset.
 *
 * Generated from `backend/prisma/seed-data.ts`, which is itself generated from the
 * uploaded "Business Unit & Department List.xlsx" - so the demo shows exactly the
 * same 9 business units and 104 departments as the real platform.
 */

export interface DemoDepartment {
  code: string;
  name: string;
}

export interface DemoBusinessUnit {
  code: string;
  name: string;
  shortName: string;
  division: string;
  departments: DemoDepartment[];
}

export const DEMO_BUSINESS_UNITS: DemoBusinessUnit[] = [
  {
    code: "ACL",
    name: "Anwar Cement Limited",
    shortName: "Anwar Cement",
    division: "Cement",
    departments: [
      { code: "AF", name: "Accounts & Finance" },
      { code: "ADMIN", name: "Administration" },
      { code: "BMD", name: "BMD Export" },
      { code: "BD", name: "Business Development" },
      { code: "COMM", name: "Commercial" },
      { code: "CS", name: "Corporate Sales" },
      { code: "CT", name: "Corporate Treasury" },
      { code: "CR", name: "Customer Relation" },
      { code: "EL", name: "Estate & Land" },
      { code: "GHR", name: "Group HR" },
      { code: "GIT", name: "Group IT" },
      { code: "GA", name: "Growth Analytics" },
      { code: "HSI", name: "HO Store & Inventory" },
      { code: "IA", name: "Internal Audit" },
      { code: "LD", name: "Logistics and Distribution" },
      { code: "MC", name: "Marketing & Communication" },
      { code: "OPS", name: "Operations" },
      { code: "SM", name: "Sales & Marketing" },
      { code: "SADM", name: "Sales Admin" },
      { code: "SCM", name: "Supply Chain Management" },
      { code: "VT", name: "Vat & Tax" },
    ],
  },
  {
    code: "ACSL",
    name: "Anwar Cement Sheet Limited",
    shortName: "Anwar Cement Sheet",
    division: "Cement",
    departments: [
      { code: "AF", name: "Accounts & Finance" },
      { code: "ADMIN", name: "Administration" },
      { code: "BMD", name: "BMD Export" },
      { code: "COMM", name: "Commercial" },
      { code: "CMA", name: "Corporate Management Accounting" },
      { code: "CS", name: "Corporate Sales" },
      { code: "CT", name: "Corporate Treasury" },
      { code: "CR", name: "Customer Relation" },
      { code: "EL", name: "Estate & Land" },
      { code: "GHR", name: "Group HR" },
      { code: "GIT", name: "Group IT" },
      { code: "GA", name: "Growth Analytics" },
      { code: "IA", name: "Internal Audit" },
      { code: "LAR", name: "Legal Affairs and Recovery" },
      { code: "LIVE", name: "Livestock" },
      { code: "MC", name: "Marketing & Communication" },
      { code: "SM", name: "Sales & Marketing" },
      { code: "SADM", name: "Sales Admin" },
      { code: "SMC", name: "Sales Monitoring Cell" },
      { code: "SCM", name: "Supply Chain Management" },
      { code: "TRN", name: "Transport" },
      { code: "VT", name: "Vat & Tax" },
    ],
  },
  {
    code: "AIL",
    name: "Anwar Ispat Limited",
    shortName: "Anwar Ispat",
    division: "Steel",
    departments: [
      { code: "AF", name: "Accounts & Finance" },
      { code: "ADMIN", name: "Administration" },
      { code: "COMM", name: "Commercial" },
      { code: "CF", name: "Corporate Finance" },
      { code: "CMA", name: "Corporate Management Accounting" },
      { code: "CS", name: "Corporate Sales" },
      { code: "CT", name: "Corporate Treasury" },
      { code: "CR", name: "Customer Relation" },
      { code: "EL", name: "Estate & Land" },
      { code: "GHR", name: "Group HR" },
      { code: "GIT", name: "Group IT" },
      { code: "GA", name: "Growth Analytics" },
      { code: "IA", name: "Internal Audit" },
      { code: "LAR", name: "Legal Affairs and Recovery" },
      { code: "MC", name: "Marketing & Communication" },
      { code: "SM", name: "Sales & Marketing" },
      { code: "SADM", name: "Sales Admin" },
      { code: "SMC", name: "Sales Monitoring Cell" },
      { code: "SCM", name: "Supply Chain Management" },
    ],
  },
  {
    code: "AGL",
    name: "Anwar Galvanizing Limited",
    shortName: "Anwar Galvanizing",
    division: "Building Materials",
    departments: [
      { code: "AF", name: "Accounts & Finance" },
      { code: "BOD", name: "Business Operations & Development" },
      { code: "CA", name: "Corporate Affairs" },
      { code: "GA", name: "Growth Analytics" },
      { code: "SADM", name: "Sales Admin" },
      { code: "SCM", name: "Supply Chain Management" },
    ],
  },
  {
    code: "AOPL",
    name: "A-One Polymer Limited",
    shortName: "A-One Polymer",
    division: "Building Materials",
    departments: [
      { code: "AF", name: "Accounts & Finance" },
      { code: "ADMIN", name: "Administration" },
      { code: "BMD", name: "BMD Export" },
      { code: "BOD", name: "Business Operations & Development" },
      { code: "COMM", name: "Commercial" },
      { code: "CF", name: "Corporate Finance" },
      { code: "CMA", name: "Corporate Management Accounting" },
      { code: "CS", name: "Corporate Sales" },
      { code: "CT", name: "Corporate Treasury" },
      { code: "CR", name: "Customer Relation" },
      { code: "DT", name: "Digital Transformation" },
      { code: "EL", name: "Estate & Land" },
      { code: "GHR", name: "Group HR" },
      { code: "GIT", name: "Group IT" },
      { code: "GA", name: "Growth Analytics" },
      { code: "HSI", name: "HO Store & Inventory" },
      { code: "IA", name: "Internal Audit" },
      { code: "LD", name: "Logistics and Distribution" },
      { code: "MC", name: "Marketing & Communication" },
      { code: "OPS", name: "Operations" },
      { code: "PDS", name: "Product Development & Servicing" },
      { code: "SM", name: "Sales & Marketing" },
      { code: "SADM", name: "Sales Admin" },
      { code: "SMC", name: "Sales Monitoring Cell" },
      { code: "SCM", name: "Supply Chain Management" },
      { code: "TND", name: "Tender" },
      { code: "TRN", name: "Transport" },
      { code: "VT", name: "Vat & Tax" },
    ],
  },
  {
    code: "AESL",
    name: "Anwar Enterprise Systems Limited",
    shortName: "Anwar Technologies",
    division: "Technology",
    departments: [
      { code: "ADMIN", name: "Administration" },
      { code: "BOD", name: "Business Operations & Development" },
      { code: "GHR", name: "Group HR" },
      { code: "SD", name: "Software Development" },
    ],
  },
  {
    code: "HDPML",
    name: "Hossain Dyeing & Printing Mills Limited",
    shortName: "Anwar Textile",
    division: "Textile",
    departments: [
      { code: "HSI", name: "HO Store & Inventory" },
    ],
  },
  {
    code: "BHB",
    name: "BHB — Anwar Landmark (Real Estate & Property)",
    shortName: "Anwar Landmark",
    division: "Real Estate",
    departments: [
      { code: "CSR", name: "CSR" },
      { code: "PM", name: "Property Management" },
    ],
  },
  {
    code: "AISPL",
    name: "AISPL",
    shortName: "AISPL",
    division: "Group Administration",
    departments: [
      { code: "ADMIN", name: "Administration" },
    ],
  },
];

export const DEMO_ORGANISATION_STATS = { businessUnits: 9, departments: 104 };
