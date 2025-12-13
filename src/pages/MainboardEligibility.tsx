import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { saveAssessmentResponse, type AssessmentResponse, type QuestionResponse } from "@/lib/supabase";
import { sendAssessmentReport, type EmailData } from "@/lib/emailService";
import { logUserEvent } from "@/lib/logger";
import evernileLogo from "@/assets/Evernile Capital Logo_OG (1).png";
import ipoCompassLogo from "@/assets/IPO Compass Logo.png";
import emailIcon from "@/assets/Email Icons IPO Compass UI.png";

type Option = { text: string; weight: number };
type Q = { id: number; question: string; options: Option[] };

const QUESTIONS: Q[] = [
  {
    id: 1,
    question: "Type of Company",
    options: [
      { text: "Public Limited", weight: 4 },
      { text: "Private Limited", weight: 4 },
      { text: "Partnership Firm", weight: 2 },
      { text: "Proprietorship", weight: 2 },
    ],
  },
  {
    id: 2,
    question: "The Business is in existence for",
    options: [
      { text: "0 to 2 Years", weight: 2 },
      { text: "2 to 3 Years", weight: 3 },
      { text: "3 to 10 Years", weight: 4 },
      { text: "More than 10 Years", weight: 4 },
    ],
  },
  {
    id: 3,
    question: "When are you planning to file the IPO",
    options: [
      { text: "In one year", weight: 3 },
      { text: "In two years", weight: 2 },
      { text: "Not sure", weight: 1 },
    ],
  },
  {
    id: 4,
    question: "PAT/Net profit of the company for the last Financial Year",
    options: [
      { text: "0 to 5 Crore", weight: 3 },
      { text: "5 to 10 Crore", weight: 4 },
      { text: "More than 10 Crore", weight: 4 },
      { text: "Don't know", weight: 1 },
    ],
  },
];

type Answer = { questionId: number; selected: string; weight: number };

function mapScore(total: number): { readiness: number; label: string } {
  if (total >= 14) return { readiness: 4.5, label: "High IPO Readiness" };
  if (total >= 12) return { readiness: 4.0, label: "Good IPO Readiness" };
  if (total >= 10) return { readiness: 3.5, label: "Moderate IPO Readiness" };
  if (total >= 8) return { readiness: 3.0, label: "Basic IPO Readiness" };
  return { readiness: 2.5, label: "Low Readiness" };
}

function closingMessage(score: number): string {
  if (score === 4.5) {
    return "Based on the data provided in the assessment, your company has a high IPO readiness. To understand how to proceed ahead with the mainboard IPO, please book a Readiness call with our IPO Expert Team.";
  } else if (score === 4.0) {
    return "Based on the data provided in the assessment, your company has a good IPO readiness. To understand how to proceed ahead with the mainboard IPO, please book a Readiness call with our IPO Expert Team.";
  } else if (score === 3.5) {
    return "Based on the data provided in the assessment, your company shows moderate IPO readiness. To explore the next steps and improve readiness, please book a Readiness call with our IPO Expert team.";
  } else if (score === 3.0) {
    return "Based on the data provided in the assessment, your company has basic IPO readiness. We recommend booking a Readiness call with our IPO Expert team to assist in progressing further.";
  }
  return "Based on the data provided in the assessment, your company needs to enhance its IPO readiness. To understand how to strengthen your position, please book a Readiness call with our team.";
}

function generateDynamicPoints(answers: Answer[]): string[] {
  const points: string[] = [];
  const byId = new Map<number, Answer>(answers.map(a => [a.questionId, a]));

  // Question 2: Business Existence Duration (Key Assessment Highlight)
  const q2 = byId.get(2);
  if (q2) {
    if (q2.selected === "0 to 2 Years" || q2.selected === "2 to 3 Years") {
      points.push("As per regulatory guideline a company should be in existence for 3 or more years");
    } else if (q2.selected === "3 to 10 Years" || q2.selected === "More than 10 Years") {
      points.push("Your company fulfills the regulatory criteria of existence for more than 3 years");
    }
  }

  return points;
}

const OptionBox = ({
  selected,
  onClick,
  text,
  letter,
}: {
  selected: boolean;
  onClick: () => void;
  text: string;
  letter: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center gap-4 border border-white/30 bg-white/5 px-5 py-4 text-left text-base transition-all duration-200 hover:bg-white/10 sm:px-6 sm:py-5 sm:text-lg ${
      selected ? "border-evernile-red bg-[#0f2753] shadow-[0_0_0_3px_rgba(239,59,84,0.4)]" : ""
    }`}
  >
    <span className="text-sm font-semibold uppercase tracking-wide text-white sm:text-base shrink-0">
      {letter}.
    </span>
    <span className="flex-1 text-white break-words">{text}</span>
  </button>
);

const MainboardEligibility = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<number>(0); // 0..QUESTIONS.length then contact
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [showReport, setShowReport] = useState<boolean>(false);
  const [isEmailSent, setIsEmailSent] = useState<boolean>(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState<boolean>(false);
  const [infoModalOpen, setInfoModalOpen] = useState<boolean>(false);
  const [infoContent, setInfoContent] = useState<{ title: string; description: string; formula: string } | null>(null);

  const allAnswered = useMemo(() => Object.keys(answers).length === QUESTIONS.length, [answers]);
  const current = QUESTIONS[step];
  const canNext = !!(current && answers[current.id]);

  const answerList: Answer[] = useMemo(() => Object.values(answers).sort((a, b) => a.questionId - b.questionId), [answers]);
  const totalWeight = useMemo(() => answerList.reduce((t, a) => t + a.weight, 0), [answerList]);
  const scoreMeta = useMemo(() => mapScore(totalWeight), [totalWeight]);
  const dynamicPoints = useMemo(() => generateDynamicPoints(answerList), [answerList]);

  useEffect(() => {
    logUserEvent('mainboard_page_loaded');
  }, []);

  useEffect(() => {
    if (step < QUESTIONS.length) {
      const question = QUESTIONS[step];
      logUserEvent('mainboard_question_loaded', {
        questionId: question.id,
        step: step + 1,
        question: question.question
      });
    } else if (step === QUESTIONS.length && !showReport) {
      logUserEvent('mainboard_contact_form_loaded');
    }
  }, [step, showReport]);

  useEffect(() => {
    if (showReport) {
      logUserEvent('mainboard_report_viewed', {
        readinessScore: scoreMeta.readiness,
        readinessLabel: scoreMeta.label,
        totalScore: totalWeight
      });
    }
  }, [showReport, scoreMeta, totalWeight]);

  const onSelect = (q: Q, opt: Option) => {
    setAnswers(prev => ({ ...prev, [q.id]: { questionId: q.id, selected: opt.text, weight: opt.weight } }));
  };

  const onNext = () => {
    if (current && !canNext) return;
    if (step < QUESTIONS.length - 1) setStep(step + 1);
    else setStep(QUESTIONS.length); // contact step
  };

  const openInfoModal = (title: string, description: string, formula: string) => {
    setInfoContent({ title, description, formula });
    setInfoModalOpen(true);
  };

  const handlePrevious = () => {
    if (step === 0) {
      navigate("/");
      return;
    }
    setStep(prev => Math.max(prev - 1, 0));
  };

  const canCreateReport = allAnswered && name.trim() !== "" && (email.trim() !== "" || phone.trim() !== "");

  const saveAssessmentData = async () => {
    try {
      // Map answers to individual columns
      const q1 = answers[1];
      const q2 = answers[2];
      const q3 = answers[3];
      const q4 = answers[4];

      const assessmentData: Omit<AssessmentResponse, 'id' | 'created_at' | 'updated_at'> = {
        assessment_type: 'mainboard',
        user_name: name.trim(),
        user_email: email.trim(),
        user_phone: phone.trim() || undefined,
        total_score: totalWeight,
        readiness_score: scoreMeta.readiness,
        readiness_label: scoreMeta.label,
        
        // Mainboard IPO Questions
        q1_type_of_company: q1?.selected,
        q1_type_of_company_weight: q1?.weight,
        q2_business_existence: q2?.selected,
        q2_business_existence_weight: q2?.weight,
        q3_ipo_filing_timeline: q3?.selected,
        q3_ipo_filing_timeline_weight: q3?.weight,
        q4_pat_net_profit: q4?.selected,
        q4_pat_net_profit_weight: q4?.weight
      };

      await saveAssessmentResponse(assessmentData);
      console.log('Assessment data saved successfully');
    } catch (error) {
      console.error('Failed to save assessment data:', error);
      // You might want to show a toast notification here
    }
  };

  const sendEmailReport = async () => {
    setIsGeneratingReport(true);
    try {
      // Debug: Log the data being sent
      console.log('📧 Mainboard Email Data being sent:');
      console.log('  - answerList:', answerList);
      console.log('  - dynamicPoints:', dynamicPoints);
      console.log('  - scoreMeta:', scoreMeta);
      console.log('  - totalWeight:', totalWeight);

      const emailData: EmailData = {
        to: email.trim(),
        userName: name.trim(),
        assessmentType: 'mainboard',
        readinessScore: scoreMeta.readiness,
        readinessLabel: scoreMeta.label,
        totalScore: totalWeight,
        dynamicPoints: dynamicPoints,
        closingMessage: closingMessage(scoreMeta.readiness)
      };

      console.log('📧 Final email data:', emailData);

      const success = await sendAssessmentReport(emailData);
      if (success) {
        setIsEmailSent(true);
        setShowReport(true);
      }
    } catch (error) {
      console.error('Failed to send email report:', error);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const progressPct = useMemo(() => {
    const completed = Math.min(step, QUESTIONS.length);
    return Math.round((completed / QUESTIONS.length) * 100);
  }, [step]);

  const AnimatedGauge = ({ score }: { score: number }) => {
    const [animatedScore, setAnimatedScore] = useState(0);
    
    useEffect(() => {
      const timer = setTimeout(() => {
        setAnimatedScore(score);
      }, 100);
      return () => clearTimeout(timer);
    }, [score]);

    const pct = (animatedScore / 5) * 100;
    const color = "#0a2a5e"; // evernile navy approx
    
    return (
      <div className="flex flex-col items-center space-y-4">
        <div className="relative w-full max-w-2xl">
          <svg viewBox="0 0 100 50" className="w-full">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#0a2a5e" />
                <stop offset="100%" stopColor="#0a2a5e" />
              </linearGradient>
            </defs>
            <path d="M10,50 A40,40 0 0,1 90,50" fill="none" stroke="#e5e7eb" strokeWidth="10" strokeLinecap="round" />
            <path 
              d="M10,50 A40,40 0 0,1 90,50" 
              fill="none" 
              stroke="url(#g)" 
              strokeWidth="10" 
              strokeLinecap="round" 
              strokeDasharray={`${pct} 100`}
              style={{
                transition: 'stroke-dasharray 2s ease-in-out'
              }}
            />
          </svg>
        </div>
        <div className="text-2xl font-bold text-evernile-navy">
          {animatedScore.toFixed(1)} out of 5
        </div>
        <div className="text-sm text-muted-foreground text-center">
          The IPO readiness score is generated based on the data provided.
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col bg-evernile-navy text-white" style={{ width: '100%', maxWidth: '100vw', minHeight: '100vh', overflowX: 'hidden', overflowY: 'auto', borderRadius: '12px', wordBreak: 'break-word' }}>
      {/* Header */}
      <header className="sticky top-0 z-50 h-[73px] border-b border-white/30 bg-white">
        <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between px-6 sm:px-8" style={{ maxWidth: 'min(900px, 100vw)' }}>
          <img
            src={evernileLogo}
            alt="Evernile Capital"
            className="h-9 w-auto sm:h-12"
            loading="eager"
            decoding="async"
          />
          <img
            src={ipoCompassLogo}
            alt="IPO Compass"
            className="h-9 w-auto sm:h-12"
            loading="eager"
            decoding="async"
          />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-3 py-2 sm:px-6 lg:px-8" style={{ maxWidth: 'min(900px, calc(100vw - 3rem))', width: '100%', boxSizing: 'border-box' }}>
        {!showReport && step < QUESTIONS.length && current ? (
          <div className="flex flex-1 flex-col items-center text-center">
            <div className="mt-[30px] mb-6 text-center">
              <h1 className="mb-0 px-2 font-semibold text-white text-[clamp(23px,4vw,34px)] leading-tight break-words">
                Mainboard IPO Readiness Assessment
              </h1>
              <p className="-mt-1 px-2 text-white/80 text-[clamp(12px,2.6vw,18px)] break-words">
                For larger companies targeting main stock exchanges
              </p>
            </div>
            <h2 className="mt-[25px] text-[23px] font-semibold sm:text-[29px] break-words px-2">
              {current.question}
            </h2>
            <div className="mt-3 flex w-full max-w-4xl items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-evernile-red transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-sm font-semibold text-white/80 sm:text-base">
                {step + 1}/{QUESTIONS.length}
              </span>
            </div>
            <div className="mt-6 grid w-full max-w-4xl gap-3 sm:grid-cols-2">
              {current.options.map((o, index) => (
                <OptionBox
                  key={o.text}
                  text={o.text}
                  letter={String.fromCharCode(65 + index)}
                  selected={answers[current.id]?.selected === o.text}
                  onClick={() => onSelect(current, o)}
                />
              ))}
            </div>
            <div className="mt-6 flex w-full max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                onClick={handlePrevious}
                variant="outline"
                className="w-full rounded-none border border-white/40 bg-transparent text-white hover:bg-white/10 sm:w-auto"
              >
                ‹ Previous
              </Button>
              <Button
                type="button"
                onClick={onNext}
                disabled={!canNext}
                className={`w-full rounded-none border text-white transition disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto ${
                  canNext
                    ? "border-evernile-red bg-evernile-red hover:bg-evernile-red/90"
                    : "border-white bg-white text-evernile-navy hover:bg-white/90"
                }`}
              >
                Continue ›
              </Button>
            </div>
          </div>
        ) : !showReport ? (
          <div className="flex flex-1 flex-col items-center text-center text-white">
            <div className="w-full max-w-4xl">
              <div className="mt-[30px] mb-6 text-center">
                <h1 className="mb-0 px-2 font-semibold text-white text-[clamp(23px,4vw,34px)] leading-tight break-words">
                  Mainboard IPO Readiness Assessment
                </h1>
                <p className="-mt-1 px-2 text-white/80 text-[clamp(12px,2.6vw,18px)] break-words">
                  For larger companies targeting main stock exchanges
                </p>
              </div>
              <div className="pt-[5px] space-y-6">
              <h2 className="text-left text-[12px] font-semibold leading-snug text-white sm:text-[18px] break-words">
                Almost there! Please fill out few details & generate your IPO Readiness Assessment Report.
              </h2>
              <div className="text-left">
                <p className="text-left text-sm font-medium tracking-wide text-white/80">
                  Please Fill in Your Details
                </p>
                <div className="mt-2 h-[2px] w-full bg-white/40" />
              </div>
              <div className="space-y-5">
                <div className="grid items-center gap-3 text-left text-[11px] text-white sm:grid-cols-[180px_minmax(0,1fr)] sm:text-xs">
                  <Label htmlFor="name" className="text-left text-[11px] text-white sm:text-xs">
                    Your Name<span className="text-evernile-red">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your Name"
                    className="rounded-none border border-white/40 bg-transparent !text-xs text-white placeholder:!text-[10px] placeholder:text-white/40 sm:placeholder:!text-xs focus:border-evernile-red focus:ring-0 !sm:text-sm"
                  />
                </div>
                <div className="grid items-center gap-3 text-left text-[11px] text-white sm:grid-cols-[180px_minmax(0,1fr)] sm:text-xs">
                  <Label htmlFor="email" className="text-left text-[11px] text-white sm:text-xs">
                    Email ID<span className="text-evernile-red">*</span>
                  </Label>
                  <Input
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="rounded-none border border-white/40 bg-transparent !text-xs text-white placeholder:!text-[10px] placeholder:text-white/40 sm:placeholder:!text-xs focus:border-evernile-red focus:ring-0 !sm:text-sm"
                  />
                </div>
                <div className="grid items-center gap-3 text-left text-[11px] text-white sm:grid-cols-[180px_minmax(0,1fr)] sm:text-xs">
                  <Label htmlFor="phone" className="text-left text-[11px] text-white sm:text-xs">
                    Mobile No.
                  </Label>
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="xxxx xxxxx"
                    className="rounded-none border border-white/40 bg-transparent !text-xs text-white placeholder:!text-[10px] placeholder:text-white/40 sm:placeholder:!text-xs focus:border-evernile-red focus:ring-0 !sm:text-sm"
                  />
                </div>
              </div>
              <Button
                disabled={!canCreateReport || isGeneratingReport}
                onClick={async () => {
                  await saveAssessmentData();
                  await sendEmailReport();
                }}
                className="w-full rounded-none bg-evernile-red py-4 text-[11px] font-semibold text-white hover:bg-evernile-red/90 break-words px-2 sm:text-sm sm:px-4"
              >
                {isGeneratingReport ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Generating Report...</span>
                  </div>
                ) : (
                  <span className="break-words whitespace-normal">Generate & Email IPO Readiness Assessment Report</span>
                )}
              </Button>
              </div>
            </div>
          </div>
        ) : !showReport ? (
          <div className="mt-14 flex flex-1 flex-col items-center text-left">
            <div className="mt-6 w-full max-w-3xl space-y-6">
              <h2 className="text-[14px] font-semibold leading-snug sm:text-[20px] break-words">
                Almost there! Please fill out few details & generate your IPO Readiness Assessment Report.
              </h2>
              <div>
                <p className="text-base font-medium tracking-wide text-white/80">
                  Please Fill in Your Details
                </p>
                <div className="mt-2 h-[2px] w-full bg-white/40" />
              </div>
              <div className="space-y-5">
                <div className="grid items-center gap-3 text-left text-[11px] text-white sm:grid-cols-[180px_minmax(0,1fr)] sm:text-xs">
                  <Label htmlFor="name" className="text-left text-[11px] text-white sm:text-xs">
                    Your Name<span className="text-evernile-red">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your Name"
                    className="rounded-none border border-white/40 bg-transparent !text-xs text-white placeholder:!text-[10px] placeholder:text-white/40 sm:placeholder:!text-xs focus:border-evernile-red focus:ring-0 !sm:text-sm"
                  />
                </div>
                <div className="grid items-center gap-3 text-left text-[11px] text-white sm:grid-cols-[180px_minmax(0,1fr)] sm:text-xs">
                  <Label htmlFor="email" className="text-left text-[11px] text-white sm:text-xs">
                    Email ID<span className="text-evernile-red">*</span>
                  </Label>
                  <Input
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="rounded-none border border-white/40 bg-transparent !text-xs text-white placeholder:!text-[10px] placeholder:text-white/40 sm:placeholder:!text-xs focus:border-evernile-red focus:ring-0 !sm:text-sm"
                  />
                </div>
                <div className="grid items-center gap-3 text-left text-[11px] text-white sm:grid-cols-[180px_minmax(0,1fr)] sm:text-xs">
                  <Label htmlFor="phone" className="text-left text-[11px] text-white sm:text-xs">
                    Mobile No.
                  </Label>
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="xxxx xxxxx"
                    className="rounded-none border border-white/40 bg-transparent !text-xs text-white placeholder:!text-[10px] placeholder:text-white/40 sm:placeholder:!text-xs focus:border-evernile-red focus:ring-0 !sm:text-sm"
                  />
                </div>
              </div>
              <Button
                disabled={!canCreateReport || isGeneratingReport}
                onClick={async () => {
                  await saveAssessmentData();
                  await sendEmailReport();
                }}
                className="w-full rounded-none bg-evernile-red py-4 text-[11px] font-semibold text-white hover:bg-evernile-red/90 break-words px-2 sm:text-sm sm:px-4"
              >
                {isGeneratingReport ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Generating Report...</span>
                  </div>
                ) : (
                  <span className="break-words whitespace-normal">Generate & Email IPO Readiness Assessment Report</span>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-start text-center">
            <div className="w-full max-w-4xl space-y-4">
              <div className="mt-[30px] mb-4 text-center">
                <h2 className="mb-0 px-2 font-semibold text-white text-[clamp(23px,4vw,34px)] leading-tight break-words">
                  Mainboard IPO Readiness Assessment Report!
                </h2>
              </div>
              <img
                src={emailIcon}
                alt="Email sent icon"
                className="mx-auto h-12 w-12 sm:h-16 sm:w-16"
              />
              <div className="space-y-0 text-center text-white">
                <p className="text-[20px] font-semibold">Report Sent Successfully!</p>
                <p className="mt-0 text-xs text-white/80 sm:text-sm">
                  Your Mainboard IPO Readiness Assessment report has been sent to{" "}
                  <strong>{email}</strong>
                </p>
              </div>
              <div className="flex flex-col gap-2 text-white sm:flex-row sm:items-stretch">
                <div className="flex flex-1 items-center justify-center rounded-none border border-white/25 bg-white/5 px-4 py-3 text-sm font-semibold">
                  <span className="whitespace-nowrap text-white/80">Readiness Score:</span>
                  <span className="ml-3 rounded bg-[#0d3a78] px-3 py-1 text-white">
                    {scoreMeta.readiness}/5
                  </span>
                </div>
                <div className="flex flex-1 items-center justify-center rounded-none border border-white/25 bg-white/5 px-4 py-3 text-sm font-semibold">
                  <span className="whitespace-nowrap text-white/80">Readiness Level:</span>
                  <span className="ml-3 rounded bg-[#0d3a78] px-3 py-1 text-white">
                    {scoreMeta.label}
                  </span>
                </div>
              </div>
              <p className="-mt-4 text-[8px] italic text-white/70 sm:text-[10px]">
                Please check your email inbox (and spam folder) for the detailed report.
              </p>
              <div className="mt-[10px] w-full">
                <a
                  href="https://calendly.com/bdinesh-evernile/30min"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block"
                >
                  <Button className="h-10 w-full rounded-none bg-evernile-red text-[10px] font-semibold text-white hover:bg-evernile-red/90 sm:text-xs">
                    Book a call with our IPO Expert
                  </Button>
                </a>
              </div>
              <div className="mt-[20px] flex flex-col gap-2 text-left text-white md:flex-row md:gap-4">
                <div className="flex-1 space-y-2">
                  <p className="text-sm tracking-wide text-white/60 mb-0">Contact Details</p>
                  <p className="-mt-2 text-sm font-semibold">Banala Dinesh, Associate VP</p>
                  <p className="text-xs text-white/80">
                    <a href="mailto:bdinesh@evernile.com" className="text-[#9ecbff] underline hover:text-white">
                      bdinesh@evernile.com
                    </a>
                    ,{" "}
                    <a href="tel:+918889926196" className="text-[#9ecbff] underline hover:text-white">
                      +91-8889926196
                    </a>
                  </p>
                </div>
                <div className="flex-1 text-white/70">
                  <p className="mt-0 text-[10.5px] leading-relaxed text-left sm:mt-1 sm:text-xs">
                    This is an initial readiness assessment and is not a substitute for a comprehensive
                    evaluation. For full eligibility verification, please book a free consultation.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-auto h-[60px] bg-evernile-navy">
        <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-center px-4" style={{ maxWidth: 'min(900px, 100vw)' }}>
          <p className="text-xs text-white/70 sm:text-sm">
            Copyright © 2025 Evernile. All Rights Reserved.
          </p>
        </div>
      </footer>

      <Dialog open={infoModalOpen} onOpenChange={setInfoModalOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-evernile-navy">
              {infoContent?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-evernile-navy">
            <p className="leading-relaxed text-gray-700">
              {infoContent?.description}
            </p>
            {infoContent?.formula && (
              <div className="rounded-lg border bg-gray-50 p-4">
                <p className="mb-2 text-sm font-medium text-gray-600">Formula:</p>
                <p className="font-mono text-lg font-semibold text-evernile-navy">
                  {infoContent.formula}
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MainboardEligibility;





