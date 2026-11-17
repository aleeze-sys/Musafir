using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace musafir.Controllers
{
    [Authorize]
    public class TripsController : Controller
    {
        public IActionResult Plan()
        {
            return View();
        }

        public IActionResult Compare()
        {
            return View();
        }
    }
}
