"""Read transport safety tests with synthetic responses only."""
import unittest
from unittest.mock import Mock, patch
import requests
from investment_ops.namuh import NamuhError, NamuhReadOnlyClient, probe, continuation


class NamuhTests(unittest.TestCase):
    def test_no_data_codes_are_endpoint_specific_and_require_empty_rows(self):
        client=NamuhReadOnlyClient('TEST_KEY','TEST_SECRET')
        client.read=Mock(return_value=({'rsp_cd':'11512','Output_0':[]}, {}))
        self.assertEqual(len(list(client.pages('/krstock/inquiry/v1/dailyOrderExecution', {}))),1)
        with self.assertRaises(NamuhError): list(client.pages('/gbstock/inquiry/v1/unexecuted', {}))
        client.read=Mock(return_value=({'rsp_cd':'11512','Output_0':[{'unexpected':'data'}]}, {}))
        with self.assertRaises(NamuhError): list(client.pages('/krstock/inquiry/v1/dailyOrderExecution', {}))

    def test_terminal_header_cursor_is_not_next_page(self):
        self.assertIsNone(continuation({'rsp_cd':'00166'}, {'cts':'TERMINAL'}))
        self.assertEqual(continuation({'rsp_cd':'00165'}, {'cts':'NEXT'}), 'NEXT')

    def test_continuation_requires_progress_and_cursor(self):
        client=NamuhReadOnlyClient('TEST_KEY','TEST_SECRET')
        client.read=Mock(return_value=({'rsp_cd':'00165'}, {'cts':'SAME'}))
        with self.assertRaisesRegex(NamuhError, 'REPEATED'):
            list(client.pages('/n2/acctinfo', {}))
        client.read=Mock(return_value=({'rsp_cd':'00165'}, {}))
        with self.assertRaisesRegex(NamuhError, 'MISSING'):
            list(client.pages('/n2/acctinfo', {}))

    def test_business_error_and_page_limit_fail_closed(self):
        client=NamuhReadOnlyClient('TEST_KEY','TEST_SECRET')
        client.read=Mock(return_value=({'rsp_cd':'99999'}, {}))
        with self.assertRaisesRegex(NamuhError, 'STATUS_UNVERIFIED'):
            list(client.pages('/n2/acctinfo', {}))
        client.read=Mock(return_value=({'rsp_cd':'00165'}, {'cts':'NEXT'}))
        with self.assertRaisesRegex(NamuhError, 'PAGE_LIMIT'):
            list(client.pages('/n2/acctinfo', {}, max_pages=1))

    def test_order_path_blocked_before_auth(self):
        session = Mock()
        client = NamuhReadOnlyClient('TEST_KEY','TEST_SECRET',session=session)
        with self.assertRaises(NamuhError): client.read('/krstock/order/cashbuy')
        session.post.assert_not_called()

    def test_unidentified_live_account_not_probed_for_balances(self):
        with patch.dict('os.environ', {}, clear=True), patch('investment_ops.namuh.load_dotenv'), patch('investment_ops.namuh.NamuhReadOnlyClient') as factory:
            factory.return_value.read.return_value = ({'rsp_cd':'00000','Output_0':[{'acct_no':'SYNTHETIC_IRP_ACCOUNT','acct_type':'01'}]}, {})
            result = probe(balances=True)
        factory.return_value.read.assert_called_once_with('/n2/acctinfo')
        self.assertEqual(result['balance_probes'], [])

    def test_token_reused_in_process_and_redirects_disabled(self):
        session=Mock()
        auth=Mock(status_code=200); auth.json.return_value={'access_token':'TEST_TOKEN'}
        response=Mock(status_code=200,headers={}); response.json.return_value={'rsp_cd':'00000','Output_0':[]}
        session.post.side_effect=[auth,response,response]
        client=NamuhReadOnlyClient('TEST_KEY','TEST_SECRET',session=session)
        client.read('/n2/acctinfo'); client.read('/n2/acctinfo')
        self.assertEqual(session.post.call_count,3)
        for call in session.post.call_args_list: self.assertFalse(call.kwargs['allow_redirects'])

    def test_network_error_does_not_expose_credentials(self):
        session=Mock(); session.post.side_effect=requests.RequestException('TEST_SECRET sensitive URL')
        client=NamuhReadOnlyClient('TEST_KEY','TEST_SECRET',session=session)
        with self.assertRaises(NamuhError) as caught: client.authenticate()
        self.assertNotIn('TEST_SECRET',str(caught.exception))

    def test_http_auth_error_uses_safe_code_only(self):
        session=Mock(); response=Mock(status_code=401)
        response.json.return_value={'error_code':'IGW_TEST','error_description':'TEST_SECRET'}
        session.post.return_value=response
        with self.assertRaisesRegex(NamuhError,'CODE=IGW_TEST') as caught:
            NamuhReadOnlyClient('TEST_KEY','TEST_SECRET',session=session).authenticate()
        self.assertNotIn('TEST_SECRET',str(caught.exception))


if __name__=='__main__': unittest.main()
