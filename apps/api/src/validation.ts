import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const documentSchema = z.object({
  docType: z.string().min(1).max(80),
  status: z.enum(['pending', 'received', 'verified']).default('pending'),
  fileAttached: z.boolean().default(false)
});

export const createEmployeeSchema = z.object({
  // Section A — personal & role
  fullNameLatin: z.string().min(1).max(160),
  fullNameAmharic: z.string().max(160).optional().or(z.literal('')),
  nationalId: z.string().min(1).max(60),
  dob: isoDate,
  phone: z.string().min(1).max(32),
  email: z.string().email().max(160).optional().or(z.literal('')),
  gender: z.string().max(16).optional().or(z.literal('')),
  employmentType: z.string().min(1).max(60),
  department: z.string().min(1).max(60),
  jobCategory: z.string().min(1).max(60),
  role: z.enum(['nurse', 'doctor', 'lab', 'pharmacist', 'admin']),
  eduQualification: z.string().max(500).optional().or(z.literal('')),
  jobGrade: z.string().max(20).optional().or(z.literal('')),
  specializationText: z.string().max(160).optional().or(z.literal('')),

  // Section B — role credentials
  credential: z
    .object({
      licenseNumber: z.string().max(60).optional().or(z.literal('')),
      licenseExpiry: isoDate.optional().or(z.literal('')),
      nurseGrade: z.string().max(40).optional().or(z.literal('')),
      yearsExperience: z.coerce.number().int().min(0).max(60).optional(),
      cprCertified: z.boolean().default(false),
      boardCertNumber: z.string().max(60).optional().or(z.literal('')),
      onCallEligible: z.boolean().default(false),
      specialty: z.string().max(80).optional().or(z.literal('')),
      subspecialty: z.string().max(120).optional().or(z.literal('')),
      academicRank: z.string().max(60).optional().or(z.literal('')),
      certificationType: z.string().max(80).optional().or(z.literal('')),
      educationLevel: z.string().max(60).optional().or(z.literal('')),
      previousRole: z.string().max(160).optional().or(z.literal(''))
    })
    .default({}),

  // Section B(2) — documents
  documents: z.array(documentSchema).default([]),

  // Section C — contract & pay
  contract: z.object({
    contractType: z.enum(['permanent', 'fixed']),
    hireDate: isoDate,
    probationEndDate: isoDate.optional().or(z.literal('')),
    contractEndDate: isoDate.optional().or(z.literal('')),
    baseSalaryEtb: z.coerce.number().positive(),
    riskAllowance: z.string().max(20).optional().or(z.literal('')),
    bankName: z.string().min(1).max(80),
    bankAccountNumber: z.string().min(1).max(40),
    pensionNumber: z.string().min(1).max(40),
    tinNumber: z.string().min(1).max(20)
  }),

  // Section D — emergency & status
  emergencyContact: z.object({
    name: z.string().min(1).max(160),
    relationship: z.string().min(1).max(40),
    phone: z.string().min(1).max(32)
  }),
  employmentStatus: z
    .enum(['active', 'on_leave', 'suspended', 'terminated', 'retired', 'deceased'])
    .default('active'),
  statusEffectiveDate: isoDate.optional().or(z.literal('')),
  handbookIssued: z.boolean().default(false),
  conductSigned: z.boolean().default(false)
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/** Fields an HR officer may edit after onboarding. All optional — send what changed. */
export const updateEmployeeSchema = z
  .object({
    fullNameLatin: z.string().min(1).max(160),
    fullNameAmharic: z.string().max(160).or(z.literal('')),
    nationalId: z.string().min(1).max(60),
    dob: isoDate,
    phone: z.string().min(1).max(32),
    email: z.string().email().max(160).or(z.literal('')),
    gender: z.string().max(16).or(z.literal('')),
    employmentType: z.string().min(1).max(60),
    department: z.string().min(1).max(60),
    jobCategory: z.string().min(1).max(60),
    eduQualification: z.string().max(500).or(z.literal('')),
    jobGrade: z.string().max(20).or(z.literal('')),
    employmentStatus: z.enum(['active', 'on_leave', 'suspended', 'terminated', 'retired', 'deceased']),
    contract: z
      .object({
        baseSalaryEtb: z.coerce.number().positive(),
        bankName: z.string().min(1).max(80),
        bankAccountNumber: z.string().min(1).max(40),
        pensionNumber: z.string().min(1).max(40),
        tinNumber: z.string().min(1).max(20)
      })
      .partial()
  })
  .partial();

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
