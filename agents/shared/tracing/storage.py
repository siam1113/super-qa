"""Trace Storage Client - Handles trace artifact storage via backend API."""
import os
import json
import base64
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
import httpx

from .models import TestTrace, ConsoleLogEntry, NetworkRequestEntry

logger = logging.getLogger(__name__)


class TraceStorageClient:
    """
    Handles trace artifact storage via the NestJS StorageService API.

    Uses HTTP client to communicate with the backend API,
    which handles the actual S3/MinIO operations.
    """

    def __init__(
        self,
        backend_url: Optional[str] = None,
        screenshots_prefix: str = "screenshots",
        traces_prefix: str = "traces",
        logs_prefix: str = "logs",
        timeout: int = 30,
    ):
        self.backend_url = backend_url or os.getenv(
            "BACKEND_API_URL",
            "http://localhost:4000/api"
        )
        self.screenshots_prefix = screenshots_prefix
        self.traces_prefix = traces_prefix
        self.logs_prefix = logs_prefix
        self.timeout = timeout

    async def upload_screenshot(
        self,
        base64_data: str,
        test_id: str,
        action_id: str,
        screenshot_type: str,  # "before" or "after"
    ) -> str:
        """
        Upload a screenshot and return the storage key.

        Args:
            base64_data: Base64 encoded screenshot data
            test_id: Test ID for organization
            action_id: Action ID for organization
            screenshot_type: Type of screenshot (before/after)

        Returns:
            Storage key for the uploaded screenshot
        """
        # Generate storage key
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        key = f"{self.screenshots_prefix}/{test_id}/{action_id}_{screenshot_type}_{timestamp}.png"

        try:
            # Decode base64 data
            image_data = base64.b64decode(base64_data)

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Upload via multipart form
                files = {
                    "file": (f"{screenshot_type}.png", image_data, "image/png"),
                }
                data = {
                    "key": key,
                    "metadata": json.dumps({
                        "testId": test_id,
                        "actionId": action_id,
                        "type": screenshot_type,
                        "timestamp": datetime.now().isoformat(),
                    }),
                }

                response = await client.post(
                    f"{self.backend_url}/storage/upload",
                    files=files,
                    data=data,
                )

                if response.status_code in (200, 201):
                    result = response.json()
                    return result.get("key", key)
                else:
                    logger.warning(f"Screenshot upload failed: {response.status_code}")
                    return key

        except Exception as e:
            logger.warning(f"Screenshot upload error: {e}")
            # Return the key anyway (might be useful for debugging)
            return key

    async def upload_trace(self, trace: TestTrace) -> str:
        """
        Upload the complete trace JSON.

        Args:
            trace: TestTrace object to upload

        Returns:
            Storage key for the uploaded trace
        """
        # Generate storage key
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        key = f"{self.traces_prefix}/{trace.test_id}/{trace.run_id}_{timestamp}.json"

        try:
            trace_json = trace.to_json()

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                files = {
                    "file": ("trace.json", trace_json.encode(), "application/json"),
                }
                data = {
                    "key": key,
                    "metadata": json.dumps({
                        "testId": trace.test_id,
                        "runId": trace.run_id,
                        "status": trace.status,
                        "timestamp": datetime.now().isoformat(),
                    }),
                }

                response = await client.post(
                    f"{self.backend_url}/storage/upload",
                    files=files,
                    data=data,
                )

                if response.status_code in (200, 201):
                    result = response.json()
                    return result.get("key", key)
                else:
                    logger.warning(f"Trace upload failed: {response.status_code}")
                    return key

        except Exception as e:
            logger.warning(f"Trace upload error: {e}")
            return key

    async def upload_console_logs(
        self,
        logs: List[ConsoleLogEntry],
        test_id: str,
        run_id: str,
    ) -> str:
        """
        Upload console logs as JSON.

        Args:
            logs: List of console log entries
            test_id: Test ID
            run_id: Run ID

        Returns:
            Storage key for the uploaded logs
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        key = f"{self.logs_prefix}/{test_id}/{run_id}_console_{timestamp}.json"

        try:
            logs_data = json.dumps([log.to_dict() for log in logs], indent=2)

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                files = {
                    "file": ("console_logs.json", logs_data.encode(), "application/json"),
                }
                data = {
                    "key": key,
                    "metadata": json.dumps({
                        "testId": test_id,
                        "runId": run_id,
                        "type": "console_logs",
                        "count": len(logs),
                    }),
                }

                response = await client.post(
                    f"{self.backend_url}/storage/upload",
                    files=files,
                    data=data,
                )

                if response.status_code in (200, 201):
                    result = response.json()
                    return result.get("key", key)
                else:
                    return key

        except Exception as e:
            logger.warning(f"Console logs upload error: {e}")
            return key

    async def upload_network_log(
        self,
        requests: List[NetworkRequestEntry],
        test_id: str,
        run_id: str,
    ) -> str:
        """
        Upload network requests as HAR-like JSON.

        Args:
            requests: List of network request entries
            test_id: Test ID
            run_id: Run ID

        Returns:
            Storage key for the uploaded network log
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        key = f"{self.logs_prefix}/{test_id}/{run_id}_network_{timestamp}.json"

        try:
            # Format as simplified HAR-like structure
            har_data = {
                "log": {
                    "version": "1.2",
                    "creator": {
                        "name": "QAE Agent Tracer",
                        "version": "1.0",
                    },
                    "entries": [req.to_dict() for req in requests],
                },
            }
            network_json = json.dumps(har_data, indent=2)

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                files = {
                    "file": ("network.json", network_json.encode(), "application/json"),
                }
                data = {
                    "key": key,
                    "metadata": json.dumps({
                        "testId": test_id,
                        "runId": run_id,
                        "type": "network_log",
                        "count": len(requests),
                    }),
                }

                response = await client.post(
                    f"{self.backend_url}/storage/upload",
                    files=files,
                    data=data,
                )

                if response.status_code in (200, 201):
                    result = response.json()
                    return result.get("key", key)
                else:
                    return key

        except Exception as e:
            logger.warning(f"Network log upload error: {e}")
            return key

    async def upload_video(
        self,
        video_path: str,
        test_id: str,
        run_id: str,
    ) -> str:
        """
        Upload a video file from local path.

        Args:
            video_path: Local path to the video file
            test_id: Test ID for organization
            run_id: Run ID for organization

        Returns:
            Storage key for the uploaded video
        """
        import os

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        key = f"videos/{test_id}/{run_id}_{timestamp}.webm"

        try:
            # Read video file
            with open(video_path, "rb") as f:
                video_data = f.read()

            file_size = os.path.getsize(video_path)

            async with httpx.AsyncClient(timeout=self.timeout * 2) as client:  # Longer timeout for video
                files = {
                    "file": ("video.webm", video_data, "video/webm"),
                }
                data = {
                    "key": key,
                    "metadata": json.dumps({
                        "testId": test_id,
                        "runId": run_id,
                        "type": "video",
                        "format": "webm",
                        "sizeBytes": file_size,
                        "timestamp": datetime.now().isoformat(),
                    }),
                }

                response = await client.post(
                    f"{self.backend_url}/storage/upload",
                    files=files,
                    data=data,
                )

                if response.status_code in (200, 201):
                    result = response.json()
                    logger.info(f"Uploaded video: {key} ({file_size} bytes)")
                    return result.get("key", key)
                else:
                    logger.warning(f"Video upload failed: {response.status_code}")
                    return key

        except FileNotFoundError:
            logger.warning(f"Video file not found: {video_path}")
            return ""
        except Exception as e:
            logger.warning(f"Video upload error: {e}")
            return key

    async def get_video_url(self, key: str) -> Optional[str]:
        """
        Get a URL for a video file.

        Args:
            key: Storage key of the video

        Returns:
            URL or None if not available
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.backend_url}/storage/url",
                    params={"key": key},
                )

                if response.status_code == 200:
                    result = response.json()
                    return result.get("url")
                else:
                    return None

        except Exception as e:
            logger.warning(f"Video URL generation error: {e}")
            return None

    async def get_trace(self, key: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve a trace by key.

        Args:
            key: Storage key of the trace

        Returns:
            Trace data as dictionary or None if not found
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.backend_url}/storage/download",
                    params={"key": key},
                )

                if response.status_code == 200:
                    return response.json()
                else:
                    logger.warning(f"Trace retrieval failed: {response.status_code}")
                    return None

        except Exception as e:
            logger.warning(f"Trace retrieval error: {e}")
            return None

    async def get_screenshot_url(self, key: str) -> Optional[str]:
        """
        Get a presigned URL for a screenshot.

        Args:
            key: Storage key of the screenshot

        Returns:
            Presigned URL or None if not available
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.backend_url}/storage/url",
                    params={"key": key},
                )

                if response.status_code == 200:
                    result = response.json()
                    return result.get("url")
                else:
                    return None

        except Exception as e:
            logger.warning(f"URL generation error: {e}")
            return None

    async def delete_trace(self, key: str) -> bool:
        """
        Delete a trace and its artifacts.

        Args:
            key: Storage key of the trace

        Returns:
            True if deleted successfully
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.delete(
                    f"{self.backend_url}/storage/delete",
                    params={"key": key},
                )

                return response.status_code in (200, 204)

        except Exception as e:
            logger.warning(f"Trace deletion error: {e}")
            return False
