import WikiFrame from '@/components/wiki/WikiFrame';
import WikiExportButton from '@/components/wiki/WikiExportButton';

export default function WikiSettingsPage() {
  return <WikiFrame><div className="wiki-shell"><main className="wiki-main"><article className="wiki-article"><header className="wiki-document-head"><div><h1>내보내기와 백업</h1><p className="wiki-meta">서비스에 묶이지 않도록 문서 원본, Markdown, 이력, 첨부파일을 함께 보관합니다.</p></div></header><p className="wiki-notice">ZIP은 현재 로그인한 지정 소유자에게만 생성됩니다. 외장 하드 백업은 장치 준비 후 기존 서버 백업과 함께 연결합니다.</p><WikiExportButton /></article></main></div></WikiFrame>;
}
