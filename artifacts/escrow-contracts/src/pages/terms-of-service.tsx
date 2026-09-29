import { useEffect } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';

const privacyEmail = 'elyasahmedsultan@gmail.com';

const sections = [
  {
    id: 'agreement',
    title: '1. Agreement and scope',
    titleAr: '١. الموافقة ونطاق الشروط',
    en: [
      'These Terms of Service apply to your access to and use of PiTrust. By creating an account or using the service, you agree to these Terms and the Privacy Policy. If you do not agree, do not use PiTrust.',
      'PiTrust is operated by ELYAS AHMED SULTAN SAEED in Saudi Arabia.',
    ],
    ar: [
      'تسري شروط الخدمة هذه على دخولك إلى PiTrust واستخدامك له. بإنشاء حساب أو استخدام الخدمة، فإنك توافق على هذه الشروط وسياسة الخصوصية. إذا لم توافق، فلا تستخدم PiTrust.',
      'تُدار PiTrust بواسطة ELYAS AHMED SULTAN SAEED في المملكة العربية السعودية.',
    ],
  },
  {
    id: 'service',
    title: '2. What PiTrust provides',
    titleAr: '٢. ما تقدمه PiTrust',
    en: [
      'PiTrust provides digital tools to create and manage agreements, communicate with contract participants, and coordinate escrow-related activity and Pi Network payments. The parties to each agreement are responsible for its terms, the accuracy of the information they provide, and fulfilling their obligations.',
      'PiTrust is not a bank, law firm, or government authority. The service does not provide legal, financial, tax, or investment advice, and does not guarantee another user’s identity, performance, or delivery.',
    ],
    ar: [
      'توفر PiTrust أدوات رقمية لإنشاء الاتفاقيات وإدارتها والتواصل مع أطراف العقد وتنسيق أنشطة الضمان ومدفوعات شبكة Pi. يتحمل أطراف كل اتفاقية مسؤولية شروطها ودقة المعلومات المقدمة والوفاء بالتزاماتهم.',
      'PiTrust ليست بنكًا أو مكتب محاماة أو جهة حكومية. لا تقدم الخدمة استشارات قانونية أو مالية أو ضريبية أو استثمارية، ولا تضمن هوية مستخدم آخر أو أداءه أو تسليمه.',
    ],
  },
  {
    id: 'eligibility',
    title: '3. Eligibility and accounts',
    titleAr: '٣. الأهلية والحسابات',
    en: [
      'You must be at least 18 years old and legally able to enter into agreements to use PiTrust. Provide accurate account information, keep your sign-in credentials secure, and tell us promptly if you suspect unauthorized account use.',
      'You are responsible for activity performed through your account, except where applicable law provides otherwise.',
    ],
    ar: [
      'يجب أن يكون عمرك ١٨ عامًا على الأقل وأن تكون مؤهلًا قانونيًا لإبرام الاتفاقيات لاستخدام PiTrust. قدّم معلومات حساب دقيقة، واحفظ بيانات تسجيل الدخول بأمان، وأبلغنا فورًا إذا اشتبهت في استخدام غير مصرح به.',
      'تتحمل مسؤولية الأنشطة التي تتم عبر حسابك، إلا إذا نص القانون المعمول به على خلاف ذلك.',
    ],
  },
  {
    id: 'acceptable-use',
    title: '4. Acceptable use',
    titleAr: '٤. الاستخدام المقبول',
    en: [
      'Do not use PiTrust to break the law, commit fraud, misrepresent a transaction, infringe another person’s rights, threaten or harass others, interfere with the service, bypass security controls, or upload malicious or unlawful content. Do not use the service to evade payment-network rules or sanctions.',
    ],
    ar: [
      'يُحظر استخدام PiTrust لمخالفة القانون أو الاحتيال أو تحريف معاملة أو انتهاك حقوق الآخرين أو تهديدهم أو مضايقتهم أو تعطيل الخدمة أو تجاوز ضوابط الأمان أو رفع محتوى ضار أو غير قانوني. كما يُحظر استخدام الخدمة للتهرب من قواعد شبكة الدفع أو العقوبات.',
    ],
  },
  {
    id: 'contracts-payments',
    title: '5. Agreements, escrow, and Pi payments',
    titleAr: '٥. الاتفاقيات والضمان ومدفوعات Pi',
    en: [
      'Read and confirm the contract terms, amount, and recipient before authorizing a payment. Pi Network and other providers may impose their own requirements or fees. Blockchain transactions may be irreversible; PiTrust cannot promise that a completed transaction can be reversed.',
      'Escrow actions and any release or refund depend on the transaction status, the agreement, and the controls shown in the app. Do not assume funds have been released or returned until the app confirms the result.',
      'You and the other contract participants are responsible for providing accurate instructions and resolving disagreements. PiTrust may make service tools available to support a dispute, but it is not a court and does not guarantee a particular outcome.',
    ],
    ar: [
      'اقرأ شروط العقد والمبلغ والمستلم وتأكد منها قبل اعتماد الدفع. قد تفرض شبكة Pi ومزودون آخرون متطلباتهم أو رسومهم الخاصة. قد تكون معاملات البلوك تشين غير قابلة للإلغاء، ولا تستطيع PiTrust ضمان إمكانية عكس معاملة مكتملة.',
      'تعتمد إجراءات الضمان وأي تحرير أو استرداد على حالة المعاملة والاتفاقية والضوابط الظاهرة في التطبيق. لا تفترض أن الأموال حُررت أو أُعيدت حتى يؤكد التطبيق النتيجة.',
      'تتحمل أنت وأطراف العقد مسؤولية تقديم تعليمات دقيقة وتسوية الخلافات. قد توفر PiTrust أدوات للمساعدة في النزاع، لكنها ليست محكمة ولا تضمن نتيجة معينة.',
    ],
  },
  {
    id: 'fees',
    title: '6. Fees and third-party services',
    titleAr: '٦. الرسوم والخدمات الخارجية',
    en: [
      'Any PiTrust charge that applies to a transaction will be shown in the service before you confirm it. Network or third-party charges may also apply. Refunds and cancellations depend on the transaction state, the agreement, provider rules, and applicable law.',
      'Your use of Pi Network, authentication, hosting, and other third-party services may also be subject to those providers’ terms.',
    ],
    ar: [
      'ستظهر أي رسوم من PiTrust تنطبق على المعاملة داخل الخدمة قبل تأكيدها. وقد تُفرض أيضًا رسوم من الشبكة أو مزودي الخدمة الخارجيين. يعتمد الاسترداد والإلغاء على حالة المعاملة والاتفاقية وقواعد المزود والقانون المعمول به.',
      'قد يخضع استخدامك لشبكة Pi والمصادقة والاستضافة والخدمات الخارجية الأخرى لشروط مزوديها.',
    ],
  },
  {
    id: 'content',
    title: '7. Your content and PiTrust materials',
    titleAr: '٧. المحتوى ومواد PiTrust',
    en: [
      'You retain rights you hold in content you submit. You give PiTrust permission to host, store, display, transmit, and process that content only as reasonably needed to operate, secure, and improve the service, carry out your instructions, and meet legal obligations.',
      'PiTrust’s name, branding, software, and interface are protected by applicable intellectual-property laws. These Terms do not transfer ownership of them to you.',
    ],
    ar: [
      'تحتفظ بالحقوق التي تملكها في المحتوى الذي ترسله. وتمنح PiTrust إذنًا باستضافته وتخزينه وعرضه ونقله ومعالجته بالقدر اللازم بشكل معقول لتشغيل الخدمة وتأمينها وتحسينها وتنفيذ تعليماتك والوفاء بالالتزامات القانونية.',
      'يحمي القانون المعمول به اسم PiTrust وعلامتها التجارية وبرامجها وواجهتها. ولا تنقل هذه الشروط ملكيتها إليك.',
    ],
  },
  {
    id: 'availability',
    title: '8. Availability and liability',
    titleAr: '٨. توفر الخدمة والمسؤولية',
    en: [
      'We may change, suspend, or discontinue parts of PiTrust to maintain or protect the service. We do not promise uninterrupted availability. To the extent permitted by law, PiTrust is not liable for indirect or consequential losses arising from use of the service. Nothing in these Terms excludes liability that cannot legally be excluded.',
    ],
    ar: [
      'قد نعدّل أجزاء من PiTrust أو نعلقها أو نوقفها لصيانة الخدمة أو حمايتها. لا نضمن استمرار توفرها دون انقطاع. بالقدر الذي يسمح به القانون، لا تتحمل PiTrust مسؤولية الخسائر غير المباشرة أو التبعية الناتجة عن استخدام الخدمة. ولا تستبعد هذه الشروط أي مسؤولية لا يجوز استبعادها قانونًا.',
    ],
  },
  {
    id: 'termination',
    title: '9. Suspension and ending use',
    titleAr: '٩. التعليق وإنهاء الاستخدام',
    en: [
      'You may stop using PiTrust and request account closure by emailing the privacy contact below. We may restrict or suspend access where reasonably necessary for security, suspected fraud, a breach of these Terms, or legal compliance. Account closure does not automatically cancel or reverse an open contract or blockchain transaction.',
      'Information may be retained as described in the Privacy Policy, including where needed for an active contract, dispute, security, or legal obligation.',
    ],
    ar: [
      'يمكنك التوقف عن استخدام PiTrust وطلب إغلاق الحساب عبر مراسلة جهة الاتصال أدناه. وقد نقيّد الوصول أو نعلقه عند الحاجة المعقولة للأمان أو الاشتباه بالاحتيال أو مخالفة هذه الشروط أو الامتثال للقانون. لا يؤدي إغلاق الحساب تلقائيًا إلى إلغاء عقد مفتوح أو عكس معاملة بلوك تشين.',
      'قد نحتفظ بالبيانات وفق سياسة الخصوصية، بما في ذلك ما يلزم لعقد نشط أو نزاع أو للأمان أو لالتزام قانوني.',
    ],
  },
  {
    id: 'law-updates',
    title: '10. Governing law and changes',
    titleAr: '١٠. القانون والتعديلات',
    en: [
      'These Terms are governed by the laws of Saudi Arabia, subject to mandatory legal protections. Disputes will be handled by the competent courts in Saudi Arabia unless applicable law requires another process.',
      'We may update these Terms by posting a revised version here with a new effective date. Continued use after an update takes effect means you accept the revised Terms, to the extent allowed by law.',
    ],
    ar: [
      'تخضع هذه الشروط لأنظمة المملكة العربية السعودية، مع مراعاة الحمايات القانونية الإلزامية. تنظر المحاكم المختصة في المملكة في النزاعات، ما لم يفرض القانون المعمول به إجراءً آخر.',
      'قد نحدّث هذه الشروط بنشر نسخة معدلة هنا مع تاريخ سريان جديد. ويعني استمرارك في الاستخدام بعد سريان التعديل قبولك للشروط المعدلة بالقدر الذي يسمح به القانون.',
    ],
  },
];

export default function TermsOfServicePage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Terms of Service | PiTrust';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className="min-h-[100dvh] bg-[#0D0D0D] text-[#F2F5F3]">
      <header className="border-b border-[#26332c] bg-[#111513]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link href="/" className="inline-flex items-center gap-3 text-sm text-[#b6c5bc] transition hover:text-white">
            <ArrowLeft size={17} aria-hidden="true" />
            <span>Back to PiTrust</span>
          </Link>
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <ShieldCheck className="text-[#1DE9B6]" size={21} aria-hidden="true" />
            <span>PiTrust</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="mb-8">
          <p className="font-mono text-xs uppercase tracking-[.2em] text-[#1DE9B6]">PiTrust · Legal</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Terms of Service <span className="text-[#83958a]">/</span> شروط الخدمة
          </h1>
          <p className="mt-4 text-sm text-[#9eaea5]">
            Effective date / تاريخ السريان: September 27, 2026
          </p>
        </div>

        <aside className="mb-8 rounded-xl border border-amber-800/70 bg-amber-950/30 px-5 py-4 text-sm leading-6 text-amber-200">
          <p>These terms are provided for transparency and are not legal advice. Please have them reviewed by qualified counsel in Saudi Arabia before relying on them as a legal agreement.</p>
          <p className="mt-2 text-right" dir="rtl" lang="ar">
            هذه الشروط للتوضيح ولا تُعد استشارة قانونية. يُرجى مراجعتها مع مستشار قانوني مؤهل في السعودية قبل الاعتماد عليها كاتفاقية قانونية.
          </p>
        </aside>

        <div className="space-y-5">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="rounded-2xl border border-[#26332c] bg-[#111513] p-5 sm:p-7">
              <div lang="en">
                <h2 className="text-lg font-semibold text-[#F2F5F3]">{section.title}</h2>
                <div className="mt-3 space-y-3 text-sm leading-7 text-[#b1beb6]">
                  {section.en.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
              </div>
              <div className="mt-6 border-t border-[#26332c] pt-5 text-right" dir="rtl" lang="ar">
                <h3 className="text-lg font-semibold text-[#F2F5F3]">{section.titleAr}</h3>
                <div className="mt-3 space-y-3 text-sm leading-7 text-[#b1beb6]">
                  {section.ar.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-8 flex flex-col gap-3 border-t border-[#26332c] pt-6 text-sm text-[#9eaea5] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-4">
            <Link href="/" className="transition hover:text-[#1DE9B6]">PiTrust home / الصفحة الرئيسية</Link>
            <Link href="/privacy-policy" className="transition hover:text-[#1DE9B6]">Privacy Policy / سياسة الخصوصية</Link>
          </div>
          <a href={`mailto:${privacyEmail}`} className="transition hover:text-[#1DE9B6]">{privacyEmail}</a>
        </footer>
      </div>
    </main>
  );
}