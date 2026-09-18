export type Role = 'nurse' | 'doctor' | 'lab' | 'pharmacist' | 'admin';
export type DocStatus = 'pending' | 'received' | 'verified';

export const roleLabels: Record<Role, string> = {
	nurse: 'NURSE',
	doctor: 'DOCTOR',
	lab: 'LAB TECH',
	pharmacist: 'PHARMACIST',
	admin: 'ADMIN / SUPPORT'
};

export const roleCards: { role: Role; icon: string; label: string; label2: string }[] = [
	{ role: 'nurse', icon: 'ti-stethoscope', label: 'Nurse', label2: 'Clinical' },
	{ role: 'doctor', icon: 'ti-vaccine-bottle', label: 'Doctor', label2: 'Clinical' },
	{ role: 'lab', icon: 'ti-flask', label: 'Lab tech', label2: 'Clinical' },
	{ role: 'pharmacist', icon: 'ti-pill', label: 'Pharmacist', label2: 'Clinical' },
	{ role: 'admin', icon: 'ti-briefcase', label: 'Admin / support', label2: 'Non-clinical' }
];

export const departments = [
	'Medicine',
	'Surgery',
	'Pediatrics',
	'Gynecology',
	'Emergency',
	'OPD (Outpatient)',
	'IPD (Inpatient)',
	'Pharmacy',
	'Lab',
	'Radiology',
	'Admin',
	'Support',
	'Intensive Care Unit (ICU)'
];

export const employmentTypes = [
	'Permanent Civil Servant',
	'Contract (fixed-term)',
	'Locum / Sessional',
	'Volunteer',
	'Intern'
];

export const jobCategories = [
	'Medical Officer',
	'Nursing',
	'Allied Health',
	'Administrative',
	'Support Staff'
];

export const jobGrades = Array.from({ length: 20 }, (_, i) => `Grade ${i + 1}`);

export const specialties = [
	'Internal Medicine',
	'Pediatrics',
	'General Surgery',
	'Obstetrics and Gynecology',
	'Psychiatry',
	'Community Medicine',
	'Neurology'
];

export const subspecialtyMap: Record<string, string[]> = {
	'Internal Medicine': [
		'None — General Internal Medicine',
		'Cardiology (Cardiac Electrophysiology)',
		'Gastroenterology',
		'Nephrology',
		'Oncology',
		'Pulmonology',
		'Rheumatology',
		'Endocrinology and Metabolism',
		'Critical Care Medicine',
		'Hospice and Palliative Medicine'
	],
	Pediatrics: [
		'None — General Pediatrics',
		'Neonatal-Perinatal Medicine',
		'Pediatric Cardiology',
		'Pediatric Critical Care'
	],
	'General Surgery': [
		'None — General Surgery',
		'Cardiothoracic Surgery',
		'Vascular Surgery',
		'Transplant Surgery',
		'Pediatric Surgery',
		'Surgical Critical Care',
		'Colorectal Surgery',
		'Trauma & Acute Care Surgery',
		'Burn Surgery',
		'Endocrine Surgery',
		'Bariatric / Metabolic Surgery',
		'Hand Surgery',
		'Surgery of the Esophagus',
		'Laparoscopic / Minimally Invasive Surgery'
	],
	'Obstetrics and Gynecology': [
		'None — General OB/GYN',
		'Maternal-Fetal Medicine (MFM)',
		'Gynecologic Oncology',
		'Reproductive Endocrinology and Infertility (REI)',
		'Female Pelvic Medicine / Urogynecology',
		'Complex Family Planning'
	],
	Psychiatry: [
		'None — General Psychiatry',
		'Child & Adolescent Psychiatry',
		'Forensic Psychiatry',
		'Psychotherapy'
	],
	'Community Medicine': ['None — General Community Medicine'],
	Neurology: ['None — General Neurology']
};

export const riskAllowanceMap: Record<string, string> = {
	'Intensive Care Unit (ICU)': '15% – 20%',
	Surgery: '15% – 20%',
	Lab: '5% – 15%',
	Emergency: '10% – 15%',
	Medicine: '—',
	Pediatrics: '—',
	Gynecology: '—',
	'OPD (Outpatient)': '—',
	'IPD (Inpatient)': '10% – 15%',
	Pharmacy: '5% – 10%',
	Radiology: '10% – 15%',
	Admin: '—',
	Support: '—'
};

export const banks = ['Commercial Bank of Ethiopia (CBE)', 'Dashen Bank', 'Awash Bank'];

export const baseDocuments: { docType: string; sub: string }[] = [
	{ docType: 'Medical clearance', sub: 'Physical exam result — employer-paid screening' },
	{ docType: 'Passport photos (×8)', sub: 'Physical copies received from candidate' },
	{ docType: 'Original degree / license', sub: 'Photocopied on-site and returned to candidate' },
	{ docType: 'Police clearance certificate', sub: 'Strictly enforced — hospital tier requirement' },
	{
		docType: 'Professional license verification',
		sub: 'Cross-checked against licensing body records'
	}
];

export const fellowshipDoc = {
	docType: 'Fellowship certificate',
	sub: 'Required — subspecialty selected in Basic Info'
};

export interface MockCandidate {
	key: string;
	avatar: string;
	avatarClass: 'nurse' | 'doctor';
	displayRole: string;
	data: Record<string, unknown>;
}

export const mockCandidates: MockCandidate[] = [
	{
		key: 'nurse1',
		avatar: 'HW',
		avatarClass: 'nurse',
		displayRole: 'Nurse — ICU',
		data: {
			role: 'nurse',
			fullNameLatin: 'Helen Worku',
			fullNameAmharic: 'ሄለን ወርቁ',
			nationalId: 'KEB-04-118827',
			dob: '1994-03-12',
			phone: '+251 91 234 5678',
			email: 'helen.worku@selamhospital.et',
			gender: 'Female',
			employmentType: 'Permanent Civil Servant',
			department: 'Intensive Care Unit (ICU)',
			jobCategory: 'Nursing',
			licenseNumber: 'ETH-NURSE-00441',
			licenseExpiry: '2027-09-30',
			nurseGrade: 'Senior Nurse',
			yearsExperience: '6',
			cprCertified: true,
			eduQualification: 'BSc Nursing, Addis Ababa University, 2018',
			jobGrade: 'Grade 8',
			contractType: 'permanent',
			hireDate: '2024-02-01',
			baseSalaryEtb: '9500',
			bankName: 'Commercial Bank of Ethiopia (CBE)',
			bankAccountNumber: '1000123456789',
			pensionNumber: 'POEPF-882910',
			tinNumber: '0012345678',
			emergencyName: 'Tinsae Worku',
			emergencyRelationship: 'Sibling',
			emergencyPhone: '+251 91 555 0001'
		}
	},
	{
		key: 'nurse2',
		avatar: 'TH',
		avatarClass: 'nurse',
		displayRole: 'Nurse — Surgery',
		data: {
			role: 'nurse',
			fullNameLatin: 'Tigist Haile',
			fullNameAmharic: 'ትግስት ሃይለ',
			nationalId: 'KEB-09-227311',
			dob: '1996-11-05',
			phone: '+251 92 345 1190',
			email: 'tigist.haile@selamhospital.et',
			gender: 'Female',
			employmentType: 'Contract (fixed-term)',
			department: 'Surgery',
			jobCategory: 'Nursing',
			licenseNumber: 'ETH-NURSE-00892',
			licenseExpiry: '2026-12-15',
			nurseGrade: 'Junior Nurse',
			yearsExperience: '2',
			cprCertified: true,
			eduQualification: 'BSc Nursing, Gondar University, 2022',
			jobGrade: 'Grade 4',
			contractType: 'fixed',
			hireDate: '2025-01-15',
			contractEndDate: '2026-01-14',
			baseSalaryEtb: '6800',
			bankName: 'Dashen Bank',
			bankAccountNumber: '0145567788991',
			pensionNumber: 'POEPF-901442',
			tinNumber: '0098765432',
			emergencyName: 'Daniel Haile',
			emergencyRelationship: 'Parent',
			emergencyPhone: '+251 92 555 0002'
		}
	},
	{
		key: 'doctor1',
		avatar: 'DA',
		avatarClass: 'doctor',
		displayRole: 'Doctor — Pediatrics',
		data: {
			role: 'doctor',
			fullNameLatin: 'Dr. Abdisa Bekele',
			fullNameAmharic: 'ዶ/ር አብዲሳ በቀለ',
			nationalId: 'KEB-12-445190',
			dob: '1985-07-22',
			phone: '+251 91 122 3344',
			email: 'abdisa.bekele@selamhospital.et',
			gender: 'Male',
			employmentType: 'Permanent Civil Servant',
			department: 'Pediatrics',
			jobCategory: 'Medical Officer',
			licenseNumber: 'ETH-DOC-00823',
			licenseExpiry: '2027-05-31',
			boardCertNumber: 'BC-2014-1190',
			onCallEligible: true,
			specialty: 'Pediatrics',
			subspecialty: 'Pediatric Cardiology',
			academicRank: 'Associate Professor',
			eduQualification: 'MD, Addis Ababa University, 2012 — Pediatrics Residency, Black Lion Hospital',
			jobGrade: 'Grade 16',
			specializationText: 'Pediatrics > Pediatric Cardiology',
			contractType: 'permanent',
			hireDate: '2019-09-01',
			baseSalaryEtb: '32000',
			bankName: 'Commercial Bank of Ethiopia (CBE)',
			bankAccountNumber: '1000998877665',
			pensionNumber: 'POEPF-445102',
			tinNumber: '0011223344',
			emergencyName: 'Sara Abdisa',
			emergencyRelationship: 'Spouse',
			emergencyPhone: '+251 91 555 0003'
		}
	},
	{
		key: 'doctor2',
		avatar: 'DM',
		avatarClass: 'doctor',
		displayRole: 'Doctor — General Surgery',
		data: {
			role: 'doctor',
			fullNameLatin: 'Dr. Meron Tesfaye',
			fullNameAmharic: 'ዶ/ር ሜሮን ተስፋዬ',
			nationalId: 'KEB-07-339850',
			dob: '1988-01-30',
			phone: '+251 93 667 7211',
			email: 'meron.tesfaye@selamhospital.et',
			gender: 'Female',
			employmentType: 'Contract (fixed-term)',
			department: 'Surgery',
			jobCategory: 'Medical Officer',
			licenseNumber: 'ETH-DOC-01144',
			licenseExpiry: '2026-03-31',
			boardCertNumber: 'BC-2017-0552',
			onCallEligible: true,
			specialty: 'General Surgery',
			subspecialty: 'Pediatric Surgery',
			academicRank: 'Assistant Professor',
			eduQualification: 'MD, Jimma University, 2015 — General Surgery Residency, St. Paul Hospital',
			jobGrade: 'Grade 14',
			specializationText: 'General Surgery > Pediatric Surgery',
			contractType: 'fixed',
			hireDate: '2025-03-01',
			contractEndDate: '2026-02-28',
			baseSalaryEtb: '28500',
			bankName: 'Awash Bank',
			bankAccountNumber: '0177889911002',
			pensionNumber: 'POEPF-661230',
			tinNumber: '0055667788',
			emergencyName: 'Yonas Tesfaye',
			emergencyRelationship: 'Sibling',
			emergencyPhone: '+251 93 555 0004'
		}
	}
];
