export default function ComingSoon({ title }) {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <div className="text-center">
        <p className="text-lg font-semibold text-slate-800">{title}</p>
        <p className="mt-1 text-sm text-slate-400">หน้านี้อยู่ระหว่างพัฒนาตามลำดับ Phase ในแผนงาน</p>
      </div>
    </div>
  );
}
