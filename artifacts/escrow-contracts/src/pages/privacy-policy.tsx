import { useEffect } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import { PI_SANDBOX } from '@/lib/pi-sdk';

const privacyEmail = 'elyasahmedsultan@gmail.com';

const sections = [
  {
    id: 'who-we-are',
    title: '1. Who we are',
    titleAr: '١. من نحن',
    en: [
      'PiTrust is operated by ELYAS AHMED SULTAN SAEED in Saudi Arabia. This notice explains how PiTrust handles personal information when you use its website and escrow services.',
      `For privacy requests, contact ${privacyEmail}.`,
    ],
    ar: [
      'تُدار PiTrust بواسطة ELYAS AHMED SULTAN SAEED في المملكة العربية السعودية. توضح هذه السياسة كيفية التعامل مع البيانات الشخصية عند استخدام الموقع وخدمات الضمان.',
      `لطلبات الخصوصية، تواصل عبر ${privacyEmail}.`,
    ],
  },
  {
    id: 'information',
    title: '2. Information we handle',
    titleAr: '٢. البيانات التي نتعامل معها',
    en: [
      'Account and profile information, such as your name, email address, account identifier, profile details, referral information, and linked Pi UID.',
      'Contract and marketplace information, including listings, contract terms, messages, dispute details, and files or evidence you submit.',
      'Payment information needed to operate escrow, such as payment amounts, currency or Pi network, payment identifiers, transaction IDs, and payment status. Pi Network processes blockchain transactions; transaction records may be public and immutable.',
      'Basic operational and security information, such as request status and service logs. When automatic translation is used in a public chat room, the message content and selected target language are sent to Google Gemini to provide the translation.',
    ],
    ar: [
      'بيانات الحساب والملف الشخصي، مثل الاسم والبريد الإلكتروني ومعرّف الحساب وتفاصيل الملف والإحالة ومعرّف Pi UID المرتبط.',
      'بيانات السوق والعقود، بما فيها الإعلانات والشروط والرسائل وتفاصيل النزاعات والملفات أو الأدلة التي ترسلها.',
      'بيانات الدفع اللازمة لتشغيل الضمان، مثل المبالغ والعملة أو شبكة Pi ومعرّفات الدفع ومعرّفات المعاملات وحالتها. تعالج شبكة Pi معاملات البلوك تشين، وقد تكون سجلات المعاملات علنية وغير قابلة للتعديل.',
      'معلومات تشغيل وأمان أساسية، مثل حالة الطلبات وسجلات الخدمة. عند استخدام الترجمة التلقائية في غرفة دردشة عامة، يُرسل نص الرسالة واللغة المختارة إلى Google Gemini لإتمام الترجمة.',
    ],
  },
  {
    id: 'purposes',
    title: '3. How we use information',
    titleAr: '٣. كيف نستخدم البيانات',
    en: [
      'We use information to create and secure accounts, connect Pi identities, create and administer escrow contracts, process or reconcile payments, support disputes, deliver messages and automatic chat translations, prevent abuse, and meet applicable legal obligations.',
      'Only share information in a contract or message that you are comfortable sharing with the other contract participants and the service providers needed to operate the feature.',
    ],
    ar: [
      'نستخدم البيانات لإنشاء الحسابات وتأمينها، وربط هويات Pi، وإنشاء عقود الضمان وإدارتها، ومعالجة المدفوعات أو تسويتها، ودعم النزاعات، وإيصال الرسائل وترجمات الدردشة التلقائية، ومنع إساءة الاستخدام، والامتثال للالتزامات القانونية.',
      'لا تضع في العقد أو الرسائل معلومات لا ترغب في مشاركتها مع أطراف العقد ومزودي الخدمة اللازمين لتشغيل الميزة.',
    ],
  },
  {
    id: 'sharing',
    title: '4. When information is shared',
    titleAr: '٤. متى تتم مشاركة البيانات',
    en: [
      'Contract participants can see the contract information, messages, and evidence shared with them. Messages posted in a public chat room are visible to signed-in members who can access that room. We also share the minimum information needed with the service providers below, and may disclose information when required by law or to protect users and the service.',
    ],
    ar: [
      'يمكن لأطراف العقد الاطلاع على معلومات العقد والرسائل والأدلة التي تُشارك معهم. وتظهر رسائل غرف الدردشة العامة للأعضاء المسجلين الذين يمكنهم دخول الغرفة. كما نشارك الحد اللازم من البيانات مع مزودي الخدمة أدناه، وقد نفصح عنها إذا تطلب القانون ذلك أو لحماية المستخدمين والخدمة.',
    ],
  },
  {
    id: 'security',
    title: '5. Storage and security',
    titleAr: '٥. التخزين والأمان',
    en: [
      'PiTrust and its providers use access controls and other safeguards appropriate to the service. Data sent between your device and the service is intended to use HTTPS. No online service can guarantee absolute security.',
      'We retain information for as long as needed to provide the service, resolve disputes, prevent fraud, and meet legal or accounting requirements. Some Pi blockchain records cannot be changed or deleted by PiTrust.',
    ],
    ar: [
      'تستخدم PiTrust ومزودوها ضوابط وصول وتدابير حماية مناسبة للخدمة. من المفترض أن تنتقل البيانات بين جهازك والخدمة عبر HTTPS. لا يمكن لأي خدمة عبر الإنترنت ضمان الأمان المطلق.',
      'نحتفظ بالبيانات للمدة اللازمة لتقديم الخدمة وحل النزاعات ومنع الاحتيال والوفاء بالمتطلبات القانونية أو المحاسبية. لا تستطيع PiTrust تعديل أو حذف بعض سجلات بلوك تشين Pi.',
    ],
  },
  {
    id: 'rights',
    title: '6. Your choices and requests',
    titleAr: '٦. خياراتك وطلباتك',
    en: [
      'Subject to applicable law and necessary transaction or dispute records, you may contact us to request access to, correction of, or deletion of personal information, or to ask a question about its use. We may need to verify your identity before responding.',
      `Send requests to ${privacyEmail}.`,
    ],
    ar: [
      'وفقًا للقانون المعمول به وبما لا يتعارض مع حفظ سجلات المعاملات أو النزاعات اللازمة، يمكنك التواصل لطلب الوصول إلى بياناتك الشخصية أو تصحيحها أو حذفها، أو للاستفسار عن استخدامها. قد نحتاج إلى التحقق من هويتك قبل الرد.',
      `أرسل الطلبات إلى ${privacyEmail}.`,
    ],
  },
  {
    id: 'cookies',
    title: '7. Cookies and service providers',
    titleAr: '٧. ملفات الارتباط ومزودو الخدمة',
    en: [
      'The application and its providers may use essential cookies or similar storage to keep you signed in, protect sessions, and remember necessary preferences. Blocking them may affect sign-in or core features.',
    ],
    ar: [
      'قد يستخدم التطبيق ومزودوه ملفات ارتباط أو تخزينًا أساسيًا لإبقائك مسجل الدخول وحماية الجلسات وحفظ التفضيلات الضرورية. قد يؤثر حظرها في تسجيل الدخول أو الميزات الأساسية.',
    ],
  },
  {
    id: 'children',
    title: '8. Age and children',
    titleAr: '٨. العمر والقاصرون',
    en: [
      'PiTrust is intended for people aged 18 or older because it involves contracts and payments. If you believe a person under 18 has provided personal information, contact us so we can review the request.',
    ],
    ar: [
      'تستهدف PiTrust الأشخاص بعمر ١٨ عامًا فأكثر لارتباطها بالعقود والمدفوعات. إذا اعتقدت أن شخصًا دون ١٨ عامًا أرسل بيانات شخصية، تواصل معنا لمراجعة الطلب.',
    ],
  },
  {
    id: 'transfers-and-changes',
    title: '9. International processing and updates',
    titleAr: '٩. المعالجة الدولية وتحديث السياسة',
    en: [
      'Our providers may process information in locations outside Saudi Arabia. Any such processing or transfer is subject to applicable law and the providers’ safeguards.',
      'We may update this notice as the service changes. The latest version and its effective date will be posted on this page.',
    ],
    ar: [
      'قد يعالج مزودونا البيانات في مواقع خارج المملكة العربية السعودية. وتخضع أي معالجة أو عملية نقل من هذا النوع للقانون المعمول به وتدابير الحماية لدى المزودين.',
      'قد نحدّث هذه السياسة عند تغيير الخدمة. ستُنشر النسخة الأحدث وتاريخ سريانها في هذه الصفحة.',
    ],
  },
];

const providers = [
  {
    name: 'Clerk',
    href: 'https://clerk.com/legal/privacy',
    en: 'Authentication and account sessions.',
    ar: 'المصادقة وإدارة جلسات الحساب.',
  },
  {
    name: 'Supabase',
    href: 'https://supabase.com/privacy',
    en: 'Database and application records, including profiles, contracts, messages, and payment state.',
    ar: 'قاعدة البيانات وسجلات التطبيق، بما فيها الملفات الشخصية والعقود والرسائل وحالات الدفع.',
  },
  {
    name: 'Google Gemini',
    href: 'https://policies.google.com/privacy',
    en: 'Processes public chat text and the selected language when automatic room translation is used.',
    ar: 'يعالج نص الدردشة العامة واللغة المختارة عند استخدام الترجمة التلقائية للغرفة.',
  },
  {
    name: 'Pi Network',
    href: 'https://minepi.com/privacy/',
    en: 'Pi identity verification and Pi payment or transaction processing.',
    ar: 'التحقق من هوية Pi ومعالجة مدفوعات ومعاملات Pi.',
  },
  {
    name: 'Replit',
    href: 'https://replit.com/privacy-policy',
    en: 'Application hosting, operational services, and related infrastructure.',
    ar: 'استضافة التطبيق والخدمات التشغيلية والبنية التحتية المرتبطة بها.',
  },
];

export default function PrivacyPolicyPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Privacy Policy | PiTrust';

    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const createdDescription = !description;
    if (!description) {
      description = document.createElement('meta');
      description.name = 'description';
      document.head.appendChild(description);
    }
    const previousDescription = description.content;
    description.content = 'PiTrust privacy policy: information we handle, how we use it, service providers, and privacy contact details.';

    return () => {
      document.title = previousTitle;
      if (description) {
        if (createdDescription) description.remove();
        else description.content = previousDescription;
      }
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
            Privacy Policy <span className="text-[#83958a]">/</span> سياسة الخصوصية
          </h1>
          <p className="mt-4 text-sm text-[#9eaea5]">
            Effective date / تاريخ السريان: September 27, 2026
          </p>
        </div>

        {PI_SANDBOX && (
          <aside
            aria-label="Sandbox testing notice"
            data-testid="sandbox-testing-notice"
            className="mb-8 rounded-2xl border border-[#8b6a35] bg-[#211a10] p-5 sm:p-7"
          >
            <div lang="en">
              <p className="font-mono text-xs uppercase tracking-[.18em] text-[#f0c77a]">
                Sandbox · Pi Testnet
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">
                Current testing stage
              </h2>
              <p className="mt-3 text-sm leading-7 text-[#d7c9a9]">
                This PiTrust build is for testing and Pi Sandbox review. It is not the Mainnet production service.
                Pi payments or transfers made in this environment use Pi Testnet and have no Mainnet value.
              </p>
              <p className="mt-3 text-sm leading-7 text-[#d7c9a9]">
                Test activity—including profiles, contracts, disputes, and payment statuses—may be stored in the
                application database for testing and review. Do not submit sensitive real-world information.
                Features and test records may change during this stage.
              </p>
            </div>
            <div className="mt-5 border-t border-[#594728] pt-5 text-right" dir="rtl" lang="ar">
              <p className="font-mono text-xs uppercase tracking-[.18em] text-[#f0c77a]">
                Sandbox · شبكة Pi Testnet
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                المرحلة الحالية للاختبار
              </h3>
              <p className="mt-3 text-sm leading-7 text-[#d7c9a9]">
                هذا الإصدار من PiTrust مخصص للاختبار ومراجعة Pi Sandbox، وليس خدمة Mainnet الإنتاجية.
                أي دفعات أو تحويلات Pi تُنفذ في هذه البيئة تستخدم Pi Testnet ولا تحمل قيمة على Mainnet.
              </p>
              <p className="mt-3 text-sm leading-7 text-[#d7c9a9]">
                قد تُحفظ أنشطة الاختبار—مثل الملفات الشخصية والعقود والنزاعات وحالات الدفع—في قاعدة بيانات التطبيق
                لأغراض الاختبار والمراجعة. لا ترسل معلومات حقيقية حساسة. قد تتغير الميزات وسجلات الاختبار خلال هذه المرحلة.
              </p>
            </div>
          </aside>
        )}

        <aside className="mb-8 rounded-xl border border-amber-800/70 bg-amber-950/30 px-5 py-4 text-sm leading-6 text-amber-200">
          <p>This notice is for transparency and is not legal advice. Please have it reviewed by qualified counsel in Saudi Arabia before relying on it as a compliance document.</p>
          <p className="mt-2 text-right" dir="rtl" lang="ar">
            هذه السياسة للتوضيح ولا تُعد استشارة قانونية. يُرجى مراجعتها مع مستشار قانوني مؤهل في السعودية قبل الاعتماد عليها كوثيقة امتثال.
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

              {section.id === 'sharing' && (
                <ul className="mt-5 space-y-3 border-t border-[#26332c] pt-5">
                  {providers.map((provider) => (
                    <li key={provider.name} className="rounded-xl bg-[#171d19] p-4 text-sm leading-6 text-[#b1beb6]">
                      <p lang="en">
                        <a href={provider.href} target="_blank" rel="noreferrer" className="font-semibold text-[#1DE9B6] underline underline-offset-4">{provider.name}</a>
                        {' — '}{provider.en}
                      </p>
                      <p className="mt-2 text-right" dir="rtl" lang="ar">
                        <a href={provider.href} target="_blank" rel="noreferrer" className="font-semibold text-[#1DE9B6] underline underline-offset-4">{provider.name}</a>
                        {' — '}{provider.ar}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <footer className="mt-8 flex flex-col gap-3 border-t border-[#26332c] pt-6 text-sm text-[#9eaea5] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-4">
            <Link href="/" className="transition hover:text-[#1DE9B6]">PiTrust home / الصفحة الرئيسية</Link>
            <Link href="/terms-of-service" className="transition hover:text-[#1DE9B6]">Terms of Service / شروط الخدمة</Link>
          </div>
          <a href={`mailto:${privacyEmail}`} className="transition hover:text-[#1DE9B6]">{privacyEmail}</a>
        </footer>
      </div>
    </main>
  );
}