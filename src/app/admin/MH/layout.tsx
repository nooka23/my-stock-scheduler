export default function MHLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden px-4 py-3 lg:px-8 lg:py-4">
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
