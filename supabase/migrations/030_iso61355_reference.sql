-- ISO 61355 reference tables — classification of documents for plants, systems, and equipment.
-- Source: pss-document-service/61355/ CSVs (4 tables). Imported as canonical reference data.
-- IDs are preserved exactly from the source so apps can hard-code description IDs once.
--
-- pss_extension on iso61355_description allows PSS to mint org-specific entries under
-- FREE FOR USER subclass slots while keeping the canonical standard rows distinguishable.

-- Tables --------------------------------------------------------------------

create table if not exists iso61355_technical_area (
  id          int  primary key,
  code        text not null unique,                  -- 'A','B','C','E','M','P'
  description text not null
);

create table if not exists iso61355_class (
  id         int  primary key,
  class      text not null unique,                   -- 'A'..'W'
  descriptor text not null
);

create table if not exists iso61355_subclass (
  id         int  primary key,
  subclass   text not null unique,                   -- 'AA','AB','BC','CC','CD','QC' …
  descriptor text not null,
  class_id   int  not null references iso61355_class(id)
);

create index if not exists idx_iso61355_subclass_class
  on iso61355_subclass (class_id);

create table if not exists iso61355_description (
  id            int     primary key,
  description   text    not null,
  subclass_id   int     not null references iso61355_subclass(id),
  pss_extension boolean not null default false
);

create index if not exists idx_iso61355_description_subclass
  on iso61355_description (subclass_id);

-- Reference data ------------------------------------------------------------

insert into iso61355_technical_area (id, code, description) values
  (1, 'A', 'OVERALL MANAGEMENT'),
  (2, 'B', 'OVERALL TECHNOLOGY'),
  (3, 'C', 'CONSTRUCTION ENGINEERING'),
  (4, 'E', 'ELECTRICAL ENGINEERING INSTRUMENTATION AND CONTROL ENGINEERING'),
  (5, 'M', 'MECHANICAL ENGINEERING'),
  (6, 'P', 'PROCESS ENGINEERING')
on conflict (id) do nothing;

insert into iso61355_class (id, class, descriptor) values
  (1,  'A', 'DOCUMENTATION DESCRIBING DOCUMENTS'),
  (2,  'B', 'MANAGEMENT DOCUMENTS'),
  (3,  'C', 'CONTRACTUAL AND NONTECHNICAL DOCUMENTS'),
  (4,  'D', 'GENERAL TECHNICAL INFORMATION DOCUMENTS'),
  (5,  'E', 'TECHNICAL REQUIREMENT AND DIMENSIONING DOCUMENTS'),
  (6,  'F', 'FUNCTION-DESCRIBING DOCUMENTS'),
  (7,  'L', 'LOCATION DOCUMENTS'),
  (8,  'M', 'CONNECTION-DESCRIBING DOCUMENTS'),
  (9,  'P', 'OBJECT LISTINGS'),
  (10, 'Q', 'QUALITY MANAGEMENT DOCUMENTS AND SAFETY-DESCRIBING DOCUMENTS'),
  (11, 'T', 'GEOMETRICAL FORM DESCRIBING DOCUMENTS'),
  (12, 'W', 'OPERATIONAL PROTOCOLS AND RECORDS')
on conflict (id) do nothing;

insert into iso61355_subclass (id, subclass, descriptor, class_id) values
  (1,  'AA', 'ADMINISTRATIVE DOCUMENTS',                                 1),
  (2,  'AB', 'LISTS (REGARDING DOCUMENTS)',                              1),
  (3,  'AC', 'EXPLANATORY DOCUMENTS (REGARDING DOCUMENTS)',              1),
  (4,  'AZ', 'FREE FOR USER',                                            1),
  (5,  'BA', 'REGISTERS',                                                2),
  (6,  'BB', 'REPORTS',                                                  2),
  (7,  'BC', 'CORRESPONDENCE',                                           2),
  (8,  'BD', 'PROJECT CONTROL DOCUMENTS',                                2),
  (9,  'BE', 'RESOURCE PLANNING DOCUMENTS',                              2),
  (10, 'BF', 'DISPATCH, STORAGE AND TRANSPORT DOCUMENTS',                2),
  (11, 'BG', 'SITE PLANNING AND SITE ORGANIZATION DOCUMENTS',            2),
  (12, 'BH', 'DOCUMENTS REGARDING CHANGES',                              2),
  (13, 'BS', 'SECURITY DOCUMENTS',                                       2),
  (14, 'BT', 'TRAINING SPECIFIC DOCUMENTS',                              2),
  (15, 'BZ', 'FREE FOR USER',                                            2),
  (16, 'CA', 'INQUIRY, CALCULATION AND OFFER DOCUMENTS',                 3),
  (17, 'CB', 'APPROVAL DOCUMENTS',                                       3),
  (18, 'CC', 'CONTRACTUAL DOCUMENTS',                                    3),
  (19, 'CD', 'ORDER AND DELIVERY DOCUMENTS',                             3),
  (20, 'CE', 'INVOICE DOCUMENTS',                                        3),
  (21, 'CF', 'INSURANCE DOCUMENTS',                                      3),
  (22, 'CG', 'WARRANTY DOCUMENTS',                                       3),
  (23, 'CH', 'EXPERTISES',                                               3),
  (24, 'CZ', 'FREE FOR USER',                                            3),
  (25, 'DA', 'DATA SHEETS',                                              4),
  (26, 'DB', 'EXPLANATORY DOCUMENTS',                                    4),
  (27, 'DC', 'INSTRUCTIONS AND MANUALS',                                 4),
  (28, 'DD', 'TECHNICAL REPORTS',                                        4),
  (29, 'DE', 'CATALOGUES ADVERTISING DOCUMENTS',                         4),
  (30, 'DF', 'TECHNICAL PUBLICATIONS',                                   4),
  (31, 'DZ', 'FREE FOR USER',                                            4),
  (32, 'EA', 'LEGAL REQUIREMENT DOCUMENTS',                              5),
  (33, 'EB', 'STANDARDS AND REGULATIONS',                                5),
  (34, 'EC', 'TECHNICAL SPECIFICATION / REQUIREMENT DOCUMENTS',          5),
  (35, 'ED', 'DIMENSIONING DOCUMENTS',                                   5),
  (36, 'EZ', 'FREE FOR USER',                                            5),
  (37, 'FA', 'FUNCTIONAL OVERVIEW DOCUMENTS',                            6),
  (38, 'FB', 'FLOW DIAGRAMS',                                            6),
  (39, 'FC', 'MMI LAYOUT DOCUMENTS (MMI = MAN-MACHINE INTERFACE)',       6),
  (40, 'FD', 'RESERVED FOR FUTURE STANDARDIZATION',                      6),
  (41, 'FE', 'FUNCTION DESCRIPTIONS',                                    6),
  (42, 'FF', 'FUNCTION DIAGRAMS',                                        6),
  (43, 'FP', 'SIGNAL DESCRIPTIONS',                                      6),
  (44, 'FQ', 'SETTING VALUE DOCUMENTS',                                  6),
  (45, 'FR', 'RESERVED FOR FUTURE STANDARDIZATION',                      6),
  (46, 'FS', 'CIRCUITRY DOCUMENTS',                                      6),
  (47, 'FT', 'SOFTWARE SPECIFIC DOCUMENTS',                              6),
  (48, 'FZ', 'FREE FOR USER',                                            6),
  (49, 'LA', 'EXPLOITATION AND SURVEY DOCUMENTS',                        7),
  (50, 'LB', 'EARTHWORK AND FOUNDATION WORK DOCUMENTS',                  7),
  (51, 'LC', 'BUILDING CARCASS DOCUMENTS',                               7),
  (52, 'LD', 'ON-SITE LOCATION DOCUMENTS',                               7),
  (53, 'LH', 'IN-BUILDING LOCATION DOCUMENTS (ALSO APPLIED FOR SHIPS, AIRCRAFT, ETC.)', 7),
  (54, 'LU', 'IN/ON-EQUIPMENT LOCATION DOCUMENTS',                       7),
  (55, 'LZ', 'FREE FOR USER',                                            7),
  (56, 'MA', 'CONNECTION DOCUMENTS',                                     8),
  (57, 'MB', 'CABLING OR PIPING DOCUMENTS',                              8),
  (58, 'MZ', 'FREE FOR USER',                                            8),
  (59, 'PA', 'MATERIAL LISTS',                                           9),
  (60, 'PB', 'PARTS LISTS',                                              9),
  (61, 'PC', 'ITEM LISTS',                                               9),
  (62, 'PD', 'PRODUCT LISTS AND PRODUCT TYPE LISTS',                     9),
  (63, 'PE', 'RESERVED FOR FUTURE STANDARDIZATION',                      9),
  (64, 'PF', 'FUNCTION LISTS',                                           9),
  (65, 'PL', 'LOCATION LISTS',                                           9),
  (66, 'PZ', 'FREE FOR USER',                                            9),
  (67, 'QA', 'QUALITY MANAGEMENT DOCUMENTS',                            10),
  (68, 'QB', 'SAFETY-DESCRIBING DOCUMENTS',                             10),
  (69, 'QC', 'QUALITY VERIFYING DOCUMENTS',                             10),
  (70, 'QZ', 'FREE FOR USER',                                           10),
  (71, 'TA', 'PLANNING DRAWINGS',                                       11),
  (72, 'TB', 'CONSTRUCTION DRAWINGS',                                   11),
  (73, 'TC', 'MANUFACTURING AND ERECTION DRAWINGS',                     11),
  (74, 'TL', 'ARRANGEMENT DOCUMENTS',                                   11),
  (75, 'TZ', 'FREE FOR USER',                                           11),
  (76, 'WA', 'SET POINT DOCUMENTS',                                     12),
  (77, 'WT', 'LOGBOOKS',                                                12),
  (78, 'WZ', 'FREE FOR USER',                                           12)
on conflict (id) do nothing;

insert into iso61355_description (id, description, subclass_id) values
  (1,   'COVER SHEET',                                                       1),
  (2,   'TITLE SHEET',                                                       1),
  (3,   'LIST OF DOCUMENTS',                                                 2),
  (4,   'LIST OF CONTENTS INDEX',                                            2),
  (5,   'DOCUMENT DESCRIPTION',                                              3),
  (6,   'DOCUMENTATION STRUCTURE DIAGRAM',                                   3),
  (7,   'FREE FOR USER',                                                     4),
  (8,   'VENDOR LIST',                                                       5),
  (9,   'SUPPLIER LIST',                                                     5),
  (10,  'DISTRIBUTION LIST',                                                 5),
  (11,  'MEETING REPORT',                                                    6),
  (12,  'STATUS REPORT',                                                     6),
  (13,  'TECHNICAL REPORT',                                                  6),
  (14,  'DAMAGE REPORT',                                                     6),
  (15,  'INSTALLATION REPORT',                                               6),
  (16,  'COMMISSIONING REPORT',                                              6),
  (17,  'HANDING OVER PROTOCOL',                                             6),
  (18,  'LETTER',                                                            7),
  (19,  'NOTE',                                                              7),
  (20,  'DOCUMENT INTERCHANGE LIST',                                         8),
  (21,  'TIME SHEET',                                                        8),
  (22,  'TIME SCHEDULE',                                                     9),
  (23,  'ACTIVITY NETWORK PLAN',                                             9),
  (24,  'RESOURCE LOAD DIAGRAM',                                             9),
  (25,  'DISPATCH SPECIFICATION',                                           10),
  (26,  'SHIPPING LIST',                                                    10),
  (27,  'PACKING LIST',                                                     10),
  (28,  'AIRWAY BILL',                                                      10),
  (29,  'BILL OF LADING',                                                   10),
  (30,  'CERTIFICATE OF ORIGIN',                                            10),
  (31,  'STORAGE SPECIFICATION',                                            10),
  (32,  'TRANSPORT SPECIFICATION',                                          10),
  (33,  'SITE SPECIFICATION FOR PERSONNEL',                                 11),
  (34,  'CHANGE NOTIFICATION',                                              12),
  (35,  'CHANGE REQUEST',                                                   12),
  (36,  'ESCAPE PLAN',                                                      13),
  (37,  'EMERGENCY INSTRUCTION',                                            13),
  (38,  'FIRE PROTECTION PLAN',                                             13),
  (39,  'NOISE PROTECTION PLAN',                                            13),
  (40,  'TRAINING DESCRIPTION',                                             14),
  (41,  'FREE FOR USER',                                                    15),
  (42,  'INQUIRY',                                                          16),
  (43,  'CALCULATION SHEET (COMMERCIAL)',                                   16),
  (44,  'OFFER',                                                            16),
  (45,  'LETTER OF INTENT',                                                 16),
  (46,  'LETTER OF ACCEPTANCE',                                             16),
  (47,  'APPROVAL APPLICATION',                                             17),
  (48,  'ACCEPTANCE/ AUTHORIZATION',                                        17),
  (49,  'LICENSE',                                                          17),
  (50,  'CONTRACT',                                                         18),
  (51,  'FINAL ACCEPTANCE CERTIFICATE',                                     18),
  (52,  'TERMS OF DELIVERY',                                                18),
  (53,  'ORDER',                                                            19),
  (54,  'DELIVERY NOTE',                                                    19),
  (55,  'INVOICE',                                                          20),
  (56,  'INSURANCE POLICY',                                                 21),
  (57,  'DAMAGE ASSESSMENT',                                                21),
  (58,  'CERTIFICATE OF GUARANTEE',                                         22),
  (59,  'EXPERTISE',                                                        23),
  (60,  'FREE FOR USER',                                                    24),
  (61,  'DATA SHEET',                                                       25),
  (62,  'DIMENSION DRAWING',                                                25),
  (63,  'SYSTEM DESCRIPTION',                                               26),
  (64,  'STRUCTURE DIAGRAM',                                                26),
  (65,  'DESCRIPTION OF DESIGNATION SYSTEM',                                26),
  (66,  'MANUFACTURING INSTRUCTIONS',                                       27),
  (67,  'INSTALLATION INSTRUCTIONS',                                        27),
  (68,  'OPERATING INSTRUCTIONS',                                           27),
  (69,  'INSPECTION INSTRUCTIONS',                                          27),
  (70,  'MAINTENANCE INSTRUCTIONS',                                         27),
  (71,  'OPERATION MANUAL',                                                 27),
  (72,  'TECHNICAL REPORT',                                                 28),
  (73,  'R&D REPORT',                                                       28),
  (74,  'CATALOGUE',                                                        29),
  (75,  'PRODUCT LEAFLET',                                                  29),
  (76,  'TECHNICAL PUBLICATION',                                            30),
  (77,  'FREE FOR USER',                                                    31),
  (78,  'BUILDING REGULATION',                                              32),
  (79,  'OPERATION DECREE',                                                 32),
  (80,  'ENVIRONMENTAL DECREE',                                             32),
  (81,  'IEC STANDARD',                                                     33),
  (82,  'ISO STANDARD',                                                     33),
  (83,  'REQUIREMENT SPECIFICATION',                                        34),
  (84,  'TECHNICAL SPECIFICATION',                                          34),
  (85,  'CONSUMER LIST',                                                    34),
  (86,  'COMPONENT / DEVICE LIST OF INSTRUMENTATION AND CONTROL EQUIPMENT', 34),
  (87,  'MEASURING POINT AND CRITERIA LIST',                                34),
  (88,  'LIST OF MOTORS AND LOADS',                                         34),
  (89,  'TEST SPECIFICATION',                                               34),
  (90,  'MATERIAL SPECIFICATION',                                           34),
  (91,  'CALCULATION SHEET (TECHNICAL)',                                    35),
  (92,  'FREE FOR USER',                                                    36),
  (93,  'NETWORK MAP',                                                      37),
  (94,  'BLOCK DIAGRAM',                                                    38),
  (95,  'PROCESS FLOW DIAGRAM (PFD)',                                       38),
  (96,  'PIPING AND INSTRUMENTATION DIAGRAM (P & ID)',                      38),
  (97,  'UTILITY FLOW DIAGRAM (UFD)',                                       38),
  (98,  'SCREEN DISPLAY LAYOUT DRAWING',                                    39),
  (99,  'FREE FOR USER',                                                    40),
  (100, 'FUNCTION DESCRIPTION',                                             41),
  (101, 'FUNCTION DIAGRAM',                                                 42),
  (102, 'LOGIC FUNCTION DIAGRAM',                                           42),
  (103, 'FUNCTION CHART',                                                   42),
  (104, 'SEQUENCE CHART',                                                   42),
  (105, 'EQUIVALENT CIRCUIT DIAGRAM',                                       42),
  (106, 'TIME SEQUENCE CHART',                                              42),
  (107, 'SIGNAL LIST',                                                      43),
  (108, 'SETTING LIST',                                                     44),
  (109, 'FREE FOR USER',                                                    45),
  (110, 'CIRCUIT DIAGRAM',                                                  46),
  (111, 'PROGRAM DIAGRAM',                                                  47),
  (112, 'CODE LIST',                                                        47),
  (113, 'DESIGN DESCRIPTION',                                               47),
  (114, 'FREE FOR USER',                                                    48),
  (115, 'GROUND PLAN',                                                      49),
  (116, 'EXCAVATION PLAN',                                                  50),
  (117, 'FOUNDATION DRAWING',                                               50),
  (118, 'REINFORCEMENT PLAN',                                               51),
  (119, 'STATIC DRAWING',                                                   51),
  (120, 'ARRANGEMENT DRAWING (SITE)',                                       52),
  (121, 'SITE PLAN',                                                        52),
  (122, 'INSTALLATION DRAWING (SITE)',                                      52),
  (123, 'INSTALLATION DIAGRAM (SITE)',                                      52),
  (124, 'CABLE ROUTING DRAWING (SITE)',                                     52),
  (125, 'EARTHING PLAN, DRAWING (SITE)',                                    52),
  (126, 'ARRANGEMENT DRAWING (BUILDING)',                                   53),
  (127, 'BUILDING DRAWING',                                                 53),
  (128, 'INSTALLATION DIAGRAM (BUILDING)',                                  53),
  (129, 'CABLE ROUTING DRAWING (BUILDING)',                                 53),
  (130, 'EARTHING DRAWING (BUILDING)',                                      53),
  (131, 'ARRANGEMENT DRAWING (EQUIPMENT)',                                  54),
  (132, 'ASSEMBLY DRAWING',                                                 54),
  (133, 'FREE FOR USER',                                                    55),
  (134, 'CONNECTION DIAGRAM',                                               56),
  (135, 'CONNECTION TABLE',                                                 56),
  (136, 'CABLE DIAGRAM',                                                    57),
  (137, 'CABLE PULLING CARD',                                               57),
  (138, 'PIPING LIST',                                                      57),
  (139, 'FREE FOR USER',                                                    58),
  (140, 'FREE FOR USER',                                                    58),
  (141, 'MATERIAL LIST',                                                    59),
  (142, 'PARTS LIST',                                                       60),
  (143, 'SPARE PARTS LIST',                                                 60),
  (144, 'LABEL LIST',                                                       60),
  (145, 'ITEM LIST',                                                        61),
  (146, 'PRODUCT LIST',                                                     62),
  (147, 'PRODUCT TYPE LIST',                                                62),
  (148, 'FREE FOR USER',                                                    63),
  (149, 'FUNCTION LIST',                                                    64),
  (150, 'LOCATION LIST',                                                    65),
  (151, 'FREE FOR USER',                                                    66),
  (152, 'QUALITY MANUAL',                                                   67),
  (153, 'QUALITY PLAN',                                                     67),
  (154, 'QUALITY RECORD',                                                   67),
  (155, 'QUALITY GUIDELINE',                                                67),
  (156, 'AUDIT PLAN',                                                       67),
  (157, 'AUDIT REPORT',                                                     67),
  (158, 'NON-CONFORMITY REPORT',                                            67),
  (159, 'DECLARATION OF CONFORMITY',                                        67),
  (160, 'SAFETY STUDY',                                                     68),
  (161, 'RISK ASSESSMENT',                                                  68),
  (162, 'TEST CERTIFICATE',                                                 69),
  (163, 'MATERIAL CERTIFICATE',                                             69),
  (164, 'TEST REPORT',                                                      69),
  (165, 'FAULT REPORT',                                                     69),
  (166, 'FREE FOR USER',                                                    70),
  (167, 'CONCEPT DRAWING',                                                  71),
  (168, 'DESIGN DRAWING',                                                   71),
  (169, 'DIMENSION DRAWING',                                                72),
  (170, 'INTERFACE DRAWING',                                                72),
  (171, 'EXPLODED-VIEW DRAWING',                                            72),
  (172, '3D-DRAWING',                                                       72),
  (173, 'MANUFACTURING DRAWING',                                            73),
  (174, 'DRILLING PLAN',                                                    73),
  (175, 'WELDING PLAN',                                                     73),
  (176, 'LAYOUT DRAWING',                                                   74),
  (177, 'FREE FOR USER',                                                    75),
  (178, 'BATCH RECIPE',                                                     76),
  (179, 'OPERATIONAL LOG',                                                  77),
  (180, 'MAINTENANCE AND MODIFICATION LOG',                                 77),
  (181, 'TEST LOG',                                                         77),
  (182, 'FREE FOR USER',                                                    78)
on conflict (id) do nothing;

-- RLS -----------------------------------------------------------------------

alter table iso61355_technical_area enable row level security;
alter table iso61355_class           enable row level security;
alter table iso61355_subclass        enable row level security;
alter table iso61355_description     enable row level security;

create policy "Authenticated users can read iso61355_technical_area"
  on iso61355_technical_area for select to authenticated using (true);

create policy "Authenticated users can read iso61355_class"
  on iso61355_class for select to authenticated using (true);

create policy "Authenticated users can read iso61355_subclass"
  on iso61355_subclass for select to authenticated using (true);

create policy "Authenticated users can read iso61355_description"
  on iso61355_description for select to authenticated using (true);

-- Reference data is admin-managed via service role only — no public write policies.
-- pss_extension rows added via privileged migrations or admin-only SQL.
