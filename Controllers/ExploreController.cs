using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace musafir.Controllers
{
    [Authorize]
    public class ExploreController : Controller
    {
        public IActionResult Directory()
        {
            return View();
        }
    }
}
