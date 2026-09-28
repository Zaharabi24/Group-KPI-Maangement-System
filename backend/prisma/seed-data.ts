/**
 * Organisation master data — seeded from "Business Unit & Department List.xlsx"
 * (uploaded with the BRD). The BU codes and the BU→Department relationships are
 * reproduced exactly as supplied; only the human-readable names are expanded.
 * The source file contained 355 rows with duplicates and one typo
 * ("Accounts and Finance") which is normalised to "Accounts & Finance".
 */

export interface SeedDepartment {
  name: string;
  code: string;
}

export interface SeedBusinessUnit {
  code: string;
  name: string;
  shortName: string;
  division: string;
  departments: SeedDepartment[];
}

export const BUSINESS_UNITS: SeedBusinessUnit[] = [
  {
    "code": "ACL",
    "name": "Anwar Cement Limited",
    "shortName": "Anwar Cement",
    "division": "Cement",
    "departments": [
      {
        "name": "Accounts & Finance",
        "code": "AF"
      },
      {
        "name": "Administration",
        "code": "ADMIN"
      },
      {
        "name": "BMD Export",
        "code": "BMD"
      },
      {
        "name": "Business Development",
        "code": "BD"
      },
      {
        "name": "Commercial",
        "code": "COMM"
      },
      {
        "name": "Corporate Sales",
        "code": "CS"
      },
      {
        "name": "Corporate Treasury",
        "code": "CT"
      },
      {
        "name": "Customer Relation",
        "code": "CR"
      },
      {
        "name": "Estate & Land",
        "code": "EL"
      },
      {
        "name": "Group HR",
        "code": "GHR"
      },
      {
        "name": "Group IT",
        "code": "GIT"
      },
      {
        "name": "Growth Analytics",
        "code": "GA"
      },
      {
        "name": "HO Store & Inventory",
        "code": "HSI"
      },
      {
        "name": "Internal Audit",
        "code": "IA"
      },
      {
        "name": "Logistics and Distribution",
        "code": "LD"
      },
      {
        "name": "Marketing & Communication",
        "code": "MC"
      },
      {
        "name": "Operations",
        "code": "OPS"
      },
      {
        "name": "Sales & Marketing",
        "code": "SM"
      },
      {
        "name": "Sales Admin",
        "code": "SADM"
      },
      {
        "name": "Supply Chain Management",
        "code": "SCM"
      },
      {
        "name": "Vat & Tax",
        "code": "VT"
      }
    ]
  },
  {
    "code": "ACSL",
    "name": "Anwar Cement Sheet Limited",
    "shortName": "Anwar Cement Sheet",
    "division": "Cement",
    "departments": [
      {
        "name": "Accounts & Finance",
        "code": "AF"
      },
      {
        "name": "Administration",
        "code": "ADMIN"
      },
      {
        "name": "BMD Export",
        "code": "BMD"
      },
      {
        "name": "Commercial",
        "code": "COMM"
      },
      {
        "name": "Corporate Management Accounting",
        "code": "CMA"
      },
      {
        "name": "Corporate Sales",
        "code": "CS"
      },
      {
        "name": "Corporate Treasury",
        "code": "CT"
      },
      {
        "name": "Customer Relation",
        "code": "CR"
      },
      {
        "name": "Estate & Land",
        "code": "EL"
      },
      {
        "name": "Group HR",
        "code": "GHR"
      },
      {
        "name": "Group IT",
        "code": "GIT"
      },
      {
        "name": "Growth Analytics",
        "code": "GA"
      },
      {
        "name": "Internal Audit",
        "code": "IA"
      },
      {
        "name": "Legal Affairs and Recovery",
        "code": "LAR"
      },
      {
        "name": "Livestock",
        "code": "LIVE"
      },
      {
        "name": "Marketing & Communication",
        "code": "MC"
      },
      {
        "name": "Sales & Marketing",
        "code": "SM"
      },
      {
        "name": "Sales Admin",
        "code": "SADM"
      },
      {
        "name": "Sales Monitoring Cell",
        "code": "SMC"
      },
      {
        "name": "Supply Chain Management",
        "code": "SCM"
      },
      {
        "name": "Transport",
        "code": "TRN"
      },
      {
        "name": "Vat & Tax",
        "code": "VT"
      }
    ]
  },
  {
    "code": "AIL",
    "name": "Anwar Ispat Limited",
    "shortName": "Anwar Ispat",
    "division": "Steel",
    "departments": [
      {
        "name": "Accounts & Finance",
        "code": "AF"
      },
      {
        "name": "Administration",
        "code": "ADMIN"
      },
      {
        "name": "Commercial",
        "code": "COMM"
      },
      {
        "name": "Corporate Finance",
        "code": "CF"
      },
      {
        "name": "Corporate Management Accounting",
        "code": "CMA"
      },
      {
        "name": "Corporate Sales",
        "code": "CS"
      },
      {
        "name": "Corporate Treasury",
        "code": "CT"
      },
      {
        "name": "Customer Relation",
        "code": "CR"
      },
      {
        "name": "Estate & Land",
        "code": "EL"
      },
      {
        "name": "Group HR",
        "code": "GHR"
      },
      {
        "name": "Group IT",
        "code": "GIT"
      },
      {
        "name": "Growth Analytics",
        "code": "GA"
      },
      {
        "name": "Internal Audit",
        "code": "IA"
      },
      {
        "name": "Legal Affairs and Recovery",
        "code": "LAR"
      },
      {
        "name": "Marketing & Communication",
        "code": "MC"
      },
      {
        "name": "Sales & Marketing",
        "code": "SM"
      },
      {
        "name": "Sales Admin",
        "code": "SADM"
      },
      {
        "name": "Sales Monitoring Cell",
        "code": "SMC"
      },
      {
        "name": "Supply Chain Management",
        "code": "SCM"
      }
    ]
  },
  {
    "code": "AGL",
    "name": "Anwar Galvanizing Limited",
    "shortName": "Anwar Galvanizing",
    "division": "Building Materials",
    "departments": [
      {
        "name": "Accounts & Finance",
        "code": "AF"
      },
      {
        "name": "Business Operations & Development",
        "code": "BOD"
      },
      {
        "name": "Corporate Affairs",
        "code": "CA"
      },
      {
        "name": "Growth Analytics",
        "code": "GA"
      },
      {
        "name": "Sales Admin",
        "code": "SADM"
      },
      {
        "name": "Supply Chain Management",
        "code": "SCM"
      }
    ]
  },
  {
    "code": "AOPL",
    "name": "A-One Polymer Limited",
    "shortName": "A-One Polymer",
    "division": "Building Materials",
    "departments": [
      {
        "name": "Accounts & Finance",
        "code": "AF"
      },
      {
        "name": "Administration",
        "code": "ADMIN"
      },
      {
        "name": "BMD Export",
        "code": "BMD"
      },
      {
        "name": "Business Operations & Development",
        "code": "BOD"
      },
      {
        "name": "Commercial",
        "code": "COMM"
      },
      {
        "name": "Corporate Finance",
        "code": "CF"
      },
      {
        "name": "Corporate Management Accounting",
        "code": "CMA"
      },
      {
        "name": "Corporate Sales",
        "code": "CS"
      },
      {
        "name": "Corporate Treasury",
        "code": "CT"
      },
      {
        "name": "Customer Relation",
        "code": "CR"
      },
      {
        "name": "Digital Transformation",
        "code": "DT"
      },
      {
        "name": "Estate & Land",
        "code": "EL"
      },
      {
        "name": "Group HR",
        "code": "GHR"
      },
      {
        "name": "Group IT",
        "code": "GIT"
      },
      {
        "name": "Growth Analytics",
        "code": "GA"
      },
      {
        "name": "HO Store & Inventory",
        "code": "HSI"
      },
      {
        "name": "Internal Audit",
        "code": "IA"
      },
      {
        "name": "Logistics and Distribution",
        "code": "LD"
      },
      {
        "name": "Marketing & Communication",
        "code": "MC"
      },
      {
        "name": "Operations",
        "code": "OPS"
      },
      {
        "name": "Product Development & Servicing",
        "code": "PDS"
      },
      {
        "name": "Sales & Marketing",
        "code": "SM"
      },
      {
        "name": "Sales Admin",
        "code": "SADM"
      },
      {
        "name": "Sales Monitoring Cell",
        "code": "SMC"
      },
      {
        "name": "Supply Chain Management",
        "code": "SCM"
      },
      {
        "name": "Tender",
        "code": "TND"
      },
      {
        "name": "Transport",
        "code": "TRN"
      },
      {
        "name": "Vat & Tax",
        "code": "VT"
      }
    ]
  },
  {
    "code": "AESL",
    "name": "Anwar Enterprise Systems Limited",
    "shortName": "Anwar Technologies",
    "division": "Technology",
    "departments": [
      {
        "name": "Administration",
        "code": "ADMIN"
      },
      {
        "name": "Business Operations & Development",
        "code": "BOD"
      },
      {
        "name": "Group HR",
        "code": "GHR"
      },
      {
        "name": "Software Development",
        "code": "SD"
      }
    ]
  },
  {
    "code": "HDPML",
    "name": "Hossain Dyeing & Printing Mills Limited",
    "shortName": "Anwar Textile",
    "division": "Textile",
    "departments": [
      {
        "name": "HO Store & Inventory",
        "code": "HSI"
      }
    ]
  },
  {
    "code": "BHB",
    "name": "BHB — Anwar Landmark (Real Estate & Property)",
    "shortName": "Anwar Landmark",
    "division": "Real Estate",
    "departments": [
      {
        "name": "CSR",
        "code": "CSR"
      },
      {
        "name": "Property Management",
        "code": "PM"
      }
    ]
  },
  {
    "code": "AISPL",
    "name": "AISPL",
    "shortName": "AISPL",
    "division": "Group Administration",
    "departments": [
      {
        "name": "Administration",
        "code": "ADMIN"
      }
    ]
  }
];

/** Totals used by the seed summary and the documentation. */
export const ORGANISATION_STATS = {
  businessUnits: 9,
  departments: 104,
  sourceRows: 354,
};
